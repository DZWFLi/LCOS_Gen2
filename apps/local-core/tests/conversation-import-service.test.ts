import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../src/metadata-repository'
import { ConversationImportService } from '../src/conversation-import-service'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lcos-conversation-test-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite3'))
  repository.createProject({ id: 'conversation-project' as ProjectId, name: 'Conversation', rootPath: projectRoot })
  const service = new ConversationImportService(repository, { stagingRoot: join(root, 'staging') })
  return { root, repository, service }
}

describe('ConversationImportService', () => {
  it('imports one linear timeline, derives zero-token sections and searches with FTS5', async () => {
    const { repository, service } = fixture()
    try {
      const result = await service.importManual('conversation-project', {
        title: 'LCOS 设计讨论',
        scopeId: 'scope-conversation-project-root',
        workspaceId: 'workspace-conversation-project-main',
        entries: [
          { role: 'user', contentText: '先确认 MCP 重构和 Bridge 解耦。' },
          { role: 'assistant', contentText: '普通 Agent 使用 local-creative-os，执行器使用 lcos-executor。' },
          { role: 'user', contentText: '下一步做对话时间线与 FTS5 搜索。' },
          { role: 'assistant', contentText: '原始消息只保存一次，章节只是派生视图。' },
        ],
      })
      expect(result.session.messageCount).toBe(4)
      expect(result.sections).toHaveLength(2)
      const hits = await service.search('conversation-project', 'Bridge 解耦', { semantic: false, limit: 10 })
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]?.reasons).toContain('fts5')
      const projection = service.getProjection('conversation-project', result.session.id)
      expect(projection?.messages).toBeUndefined()
      expect(projection?.sections).toHaveLength(2)
      expect(repository.foreignKeyCheck()).toEqual([])
    } finally {
      service.close()
      repository.close()
    }
  })

  it('preserves locked section titles and keeps raw messages out of compact export', async () => {
    const { repository, service } = fixture()
    try {
      const result = await service.importManual('conversation-project', {
        title: '章节测试',
        scopeId: 'scope-conversation-project-root',
        entries: [
          { role: 'user', contentText: '需求阶段。' },
          { role: 'assistant', contentText: '记录需求。' },
          { role: 'user', contentText: '执行阶段。' },
          { role: 'assistant', contentText: '记录执行。' },
        ],
      })
      const first = result.sections[0]!
      service.updateSection('conversation-project', result.session.id, first.id, { title: '人工锁定章节' })
      const refreshed = service.refreshSections('conversation-project', result.session.id)
      expect(refreshed.find((section) => section.id === first.id)?.title).toBe('人工锁定章节')
      expect(refreshed.find((section) => section.id === first.id)?.lockedByUser).toBe(true)
      const compact = service.exportConversation('conversation-project', result.session.id, false)
      expect(compact.messages).toBeUndefined()
      expect(compact.source.rawTimelineIncluded).toBe(false)
      const raw = service.exportConversation('conversation-project', result.session.id, true)
      expect(raw.messages).toHaveLength(4)
      expect(raw.source.rawTimelineIncluded).toBe(true)
    } finally {
      service.close()
      repository.close()
    }
  })
})
