import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { CapturePlacementService } from '../src/capture-placement-service.js'
import { CaptureSpaceService } from '../src/capture-space-service.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import type { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import type { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

function snapshot(rootPath = 'disposable://capture'): ProjectGraphSnapshot {
  const now = '2026-08-18T00:00:00.000Z'
  const projectId = 'capture-project' as ProjectGraphSnapshot['project']['id']
  return {
    schemaVersion: 33,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: { id: projectId, name: 'Capture Project', rootPath, graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'], createdAt: now, updatedAt: now },
    scopes: [{ id: 'scope-root', projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [], artifacts: [], artifactViews: [], artifactRevisions: [], fileRecords: [], relations: [], notes: [], checkpoints: [],
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lcos-capture-space-'))
  cleanup.push(directory)
  const blobRoot = join(directory, 'blobs')
  const metadata = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repositories.push(metadata)
  // Windows：rootPath 用真实临时目录，避免 'disposable://' 含冒号导致 mkdir ENOENT。
  metadata.save(snapshot(directory))
  const staging = new CaptureStagingService(metadata, blobRoot)
  const resources = {} as UniversalResourceImportService
  const intelligence = { generateStructured: async () => undefined } as unknown as IntelligenceProviderService
  const service = new CaptureSpaceService(metadata, staging, resources, new CapturePlacementService(metadata), intelligence, blobRoot)
  return { directory, blobRoot, metadata, staging, service }
}

describe('0.1 Capture Space', () => {
  afterEach(async () => {
    // Windows 上 rm 打开中的 SQLite 文件会 hang（WAL 文件锁）；必须先 close 再删。
    for (const repository of repositories.splice(0)) {
      try { repository.close() } catch { /* already closed */ }
    }
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('persists system-level presentation with optimistic versions', async () => {
    const { service, staging } = await fixture()
    const item = await staging.enqueue({ operationId: 'capture-layout', kind: 'clipboard_text', payloadBytes: new TextEncoder().encode('hello'), source: { title: 'Hello' }, suggestedProjects: [] })
    const first = service.savePresentation({ schemaVersion: 1, views: [{ captureId: item.id, x: 12, y: 24, width: 220, height: 140 }], regions: [] }, 0)
    expect(first.version).toBe(1)
    expect(service.snapshot().presentation.views[0]).toMatchObject({ captureId: item.id, x: 12, y: 24 })
    expect(() => service.savePresentation({ schemaVersion: 1, views: [], regions: [] }, 0)).toThrow(/version conflict/i)
  })

  it('stores text bytes in the capture blob and can preview them', async () => {
    const { blobRoot, service, staging } = await fixture()
    const item = await staging.enqueue({ operationId: 'capture-text', kind: 'clipboard_text', payloadBytes: new TextEncoder().encode('Capture text survives staging.'), source: { title: 'Text Capture' }, suggestedProjects: [] })
    expect(item.payloadRef.startsWith('blob:')).toBe(true)
    const bytes = await readFile(join(blobRoot, item.payloadRef.slice(5)))
    expect(bytes.toString('utf8')).toBe('Capture text survives staging.')
    await expect(service.preview(item.id)).resolves.toMatchObject({ type: 'text', text: 'Capture text survives staging.' })
  })

  it('materializes a text capture into an existing project without deleting the cache blob', async () => {
    const { blobRoot, metadata, service, staging } = await fixture()
    const item = await staging.enqueue({ operationId: 'capture-materialize', kind: 'clipboard_text', payloadBytes: new TextEncoder().encode('Useful agent reply'), source: { title: 'Agent Reply' }, suggestedProjects: [] })
    service.savePresentation({ schemaVersion: 1, views: [{ captureId: item.id, x: 100, y: 120, width: 224, height: 148 }], regions: [] }, 0)
    const result = await service.materializeToProject([item.id], 'capture-project')
    expect(result.imported).toBe(1)
    expect(metadata.getArtifact(result.items[0]!.artifactId)?.title).toBe('Agent Reply')
    expect(metadata.getArtifactView(result.items[0]!.viewId)?.artifactId).toBe(result.items[0]!.artifactId)
    expect(metadata.getCaptureStagingItem(item.id)?.resolvedProjectId).toBe('capture-project')
    await expect(readFile(join(blobRoot, item.payloadRef.slice(5)))).resolves.toBeTruthy()
    expect(service.snapshot().items.some((candidate) => candidate.id === item.id)).toBe(false)
  })

  it('falls back to deterministic grouping when utility intelligence is unavailable', async () => {
    const { service, staging } = await fixture()
    await staging.enqueue({ operationId: 'capture-a', kind: 'clipboard_text', payloadBytes: new TextEncoder().encode('alpha'), source: { title: 'Alpha' }, suggestedProjects: [] })
    await staging.enqueue({ operationId: 'capture-b', kind: 'screenshot', payloadBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), source: { title: 'Visual' }, suggestedProjects: [] })
    const result = await service.organize()
    expect(result.usedModel).toBe(false)
    expect(result.presentation.regions.map((region) => region.label)).toEqual(expect.arrayContaining(['文字与对话', '视觉参考']))
    expect(result.presentation.views).toHaveLength(2)
  })
})
