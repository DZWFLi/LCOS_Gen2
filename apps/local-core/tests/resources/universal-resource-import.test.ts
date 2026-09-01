import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { ImportCopyService } from '../../src/import-copy-service.js'
import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { UniversalResourceImportService } from '../../src/resources/universal-resource-import-service.js'
import { UnsafeUrlError } from '../../src/resources/url-security.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('network disabled in tests')
  }))
})

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
  vi.unstubAllGlobals()
})

function setup(): {
  readonly repository: SqliteMetadataRepository
  readonly service: UniversalResourceImportService
  readonly projectId: ProjectId
  readonly scopeId: string
} {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-resources-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-resources-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({
    id: 'project-resources' as ProjectId,
    name: 'Resources',
    rootPath: projectRoot,
  })
  const service = new UniversalResourceImportService(repository, new ImportCopyService(repository))
  const scopeId = String(repository.get('project-resources')?.scopes[0]?.id ?? '')
  return { repository, service, projectId: 'project-resources' as ProjectId, scopeId }
}

describe('Universal Resource Import (U1)', () => {
  it('imports MD with zero form and creates a pending descriptor', async () => {
    const { service, projectId, scopeId } = setup()
    const outcome = await service.importFile(projectId, {
      importRequestId: 'brief-1',
      fileName: 'brief.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# Brief\n\nObjective: launch campaign.', 'utf8'),
      scopeId,
      position: { x: 10, y: 20 },
    })

    expect(outcome.sourceKind).toBe('file_copy')
    expect(outcome.understandingStatus).toBe('pending')
    expect(outcome.descriptor?.display.title).toBe('brief.md')
    expect(outcome.descriptor?.source.extension).toBe('.md')
    expect(outcome.artifact.kind).toBe('markdown')
  })

  it('imports JSON with zero form', async () => {
    const { service, projectId, scopeId } = setup()
    const outcome = await service.importFile(projectId, {
      importRequestId: 'tool-config',
      fileName: 'tools.json',
      contentType: 'application/json',
      bytes: Buffer.from('{"name":"storyboard-skill","tools":[]}', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })

    expect(outcome.artifact.kind).toBe('other')
    expect(outcome.descriptor?.source.mediaType).toBe('application/json')
  })

  it('imports DOCX as a durable artifact even when preview is unsupported', async () => {
    const { service, projectId, scopeId } = setup()
    const outcome = await service.importFile(projectId, {
      importRequestId: 'visual-spec-docx',
      fileName: 'LUMINA_visual-spec.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: Buffer.from('PK\u0003\u0004synthetic-docx-fixture', 'binary'),
      scopeId,
      position: { x: 20, y: 30 },
    })

    expect(outcome.artifact.kind).toBe('other')
    expect(outcome.fileRecord.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(outcome.artifact.currentRevisionId).toBe(outcome.revision.id)
  })

  it('reanalyze upgrades pending to ready with text analyzer summary', async () => {
    const { service, projectId, scopeId } = setup()
    const outcome = await service.importFile(projectId, {
      importRequestId: 'feedback',
      fileName: 'feedback.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('Keep the title.\nChange the ending.', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })

    const analyzed = await service.reanalyze(projectId, outcome.resourceId)
    expect(analyzed?.understanding.status).toBe('ready')
    expect(analyzed?.understanding.analyzerVersion).toBe('text-v0')
    expect(analyzed?.understanding.summary).toContain('Keep the title.')
  })

  it('imports URL as .link.md artifact with url descriptor fields', async () => {
    const { service, projectId, scopeId } = setup()
    const outcome = await service.importUrl(projectId, {
      importRequestId: 'link-1',
      url: 'https://x.feishu.cn/wiki/abc',
      title: '客户简报',
      scopeId,
      position: { x: 30, y: 40 },
    })

    expect(outcome.sourceKind).toBe('link')
    expect(outcome.artifact.title).toContain('.link.md')
    expect(outcome.descriptor?.source.kind).toBe('url')
    expect(outcome.descriptor?.source.normalizedUrl).toBe('https://x.feishu.cn/wiki/abc')
    expect(outcome.descriptor?.source.domain).toBe('x.feishu.cn')
  })

  it('rejects unsafe URLs (file, localhost, private IP)', async () => {
    const { service, projectId, scopeId } = setup()
    for (const url of ['file:///C:/secret', 'http://localhost:5173', 'http://127.0.0.1:43121', 'http://192.168.1.10']) {
      await expect(service.importUrl(projectId, {
        importRequestId: `bad-${url.length}`,
        url,
        scopeId,
        position: { x: 0, y: 0 },
      })).rejects.toBeInstanceOf(UnsafeUrlError)
    }
  })

  it('is idempotent by importRequestId and conflicts on different content', async () => {
    const { service, projectId, scopeId } = setup()
    const first = await service.importFile(projectId, {
      importRequestId: 'same-1',
      fileName: 'a.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# A', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    const replay = await service.importFile(projectId, {
      importRequestId: 'same-1',
      fileName: 'a.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# A', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    expect(replay.reused).toBe(true)
    expect(replay.resourceId).toBe(first.resourceId)

    await expect(service.importFile(projectId, {
      importRequestId: 'same-1',
      fileName: 'a.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# Different', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })).rejects.toThrow(/already used/)
  })

  it('persists descriptors across repository reopen', async () => {
    const { repository, service, projectId, scopeId } = setup()
    const outcome = await service.importFile(projectId, {
      importRequestId: 'persist-1',
      fileName: 'notes.md',
      contentType: 'text/markdown',
      bytes: Buffer.from('# Notes', 'utf8'),
      scopeId,
      position: { x: 0, y: 0 },
    })
    const databasePath = repository.databasePath
    repository.close()
    repositories.pop()

    const reopened = new SqliteMetadataRepository(databasePath)
    repositories.push(reopened)
    const descriptor = reopened.getResourceDescriptorByResourceId('project-resources', outcome.resourceId)
    expect(descriptor?.artifactId).toBe(String(outcome.artifactId))
    expect(reopened.schemaVersion).toBe(50)
  })
})






