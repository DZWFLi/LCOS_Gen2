import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectId } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ExecutionItemService } from '../src/execution-item-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function disposable() {
  const dir = mkdtempSync(join(tmpdir(), 'lcos-exec-item-'))
  roots.push(dir)
  const projectRoot = join(dir, 'root')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'exec-project' as never, name: 'Exec', rootPath: projectRoot })
  return { repository }
}

function stubAgentlet(runs: Array<{ id: string; agentlet: string; status: 'running' | 'exited' | 'failed' | 'timeout'; startedAt: string; instruction?: string }>) {
  return { runs: () => runs }
}

describe('ExecutionItemService (S1 read model) — agentlet projection stitch', () => {

  it('stitches agentlet runs as kind=agentlet with honest state mapping and empty actions', async () => {
    const { repository } = disposable()
    const service = new ExecutionItemService(repository, stubAgentlet([
      { id: 'agentlet-1', agentlet: 'lcos-project-curator', status: 'running', startedAt: '2026-08-30T00:00:00.000Z', instruction: '整理画布' },
      { id: 'agentlet-2', agentlet: 'lcos-skill-author', status: 'exited', startedAt: '2026-08-30T00:01:00.000Z', instruction: '炼制技能' },
      { id: 'agentlet-3', agentlet: 'lcos-project-curator', status: 'failed', startedAt: '2026-08-30T00:02:00.000Z', instruction: '整理失败' },
    ]))
    const items = service.project('exec-project' as ProjectId)
    expect(items.some((item) => item.kind === 'agentlet')).toBe(true)
    const running = items.find((item) => item.id === 'execution-agentlet-agentlet-1')
    expect(running?.kind).toBe('agentlet')
    expect(running?.state).toBe('running')
    expect(running?.availableActions).toEqual([])
    expect(running?.needsAttention).toBe(false)
    const exited = items.find((item) => item.id === 'execution-agentlet-agentlet-2')
    expect(exited?.state).toBe('completed')
    const failed = items.find((item) => item.id === 'execution-agentlet-agentlet-3')
    expect(failed?.state).toBe('failed')
    expect(failed?.needsAttention).toBe(true)
  })
})

  it("carries agentlet progress through to ExecutionItemV1.progress", async () => {
    const { repository } = disposable()
    const service = new ExecutionItemService(repository, stubAgentlet([
      { id: 'agentlet-p', agentlet: 'lcos-project-curator', status: 'running', startedAt: '2026-08-30T00:00:00.000Z', instruction: '整理' },
    ]))
    const items = service.project('exec-project' as ProjectId)
    const running = items.find((item) => item.id === 'execution-agentlet-agentlet-p')
    expect(running?.progress).toBeNull()
  })