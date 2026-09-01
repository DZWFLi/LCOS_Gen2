import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ImportCopyService } from '../src/import-copy-service.js'
import { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { RuntimeRegistryService } from '../src/runtime-registry-service.js'
import { CaptureApplicationService } from '../src/capture-application-service.js'
import { CapturePlacementService } from '../src/capture-placement-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

interface Rig {
  readonly dir: string
  readonly metadata: SqliteMetadataRepository
  readonly staging: CaptureStagingService
  readonly application: CaptureApplicationService
  readonly projectId: string
}

async function disposable(options: { readonly focus?: boolean } = {}): Promise<Rig> {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-capture-app-'))
  cleanup.push(dir)
  const projectRoot = join(dir, 'project-root')
  await mkdir(projectRoot, { recursive: true })
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  repositories.push(metadata)
  const projectId = 'capture-project' as ProjectGraphSnapshot['project']['id']
  metadata.createProject({ id: projectId, name: 'Capture 项目', rootPath: projectRoot })
  const registry = new RuntimeRegistryService(join(dir, 'registry.json'))
  if (options.focus !== false) registry.recordFocus(String(projectId))
  const staging = new CaptureStagingService(metadata, join(dir, 'blobs'))
  const resources = new UniversalResourceImportService(metadata, new ImportCopyService(metadata))
  const application = new CaptureApplicationService(metadata, resources, staging, registry, {
    blobRoot: join(dir, 'blobs'),
    placement: new CapturePlacementService(metadata),
  })
  return { dir, metadata, staging, application, projectId }
}

afterEach(async () => {
  // Windows 上 rm 打开中的 SQLite 文件会 hang（WAL 文件锁）；必须先 close 再删。
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 0,
    operationId: `op-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'clipboard_text',
    source: { capturedAt: new Date().toISOString() },
    payload: { type: 'text', text: '这是一段被捕获的文本' },
    ...overrides,
  } as never
}

describe('CaptureApplicationService (Phase C)', () => {
  it('recent-focus affinity imports text directly into the project', async () => {
    const { application, metadata, projectId } = await disposable()
    const input = request()
    const receipt = await application.capture(input)
    expect(receipt.status).toBe('created')
    expect(receipt.projectId).toBe(projectId)
    expect(receipt.artifactId).toBeDefined()
    expect(receipt.viewId).toBeDefined()
    expect(metadata.getLatestImportBatch(projectId)).toMatchObject({ sourceKind: 'capture', importRequestIds: [input.operationId], artifactIds: [receipt.artifactId], viewIds: [receipt.viewId] })
  })

  it('is idempotent for the same operationId', async () => {
    const { application } = await disposable()
    const first = await application.capture(request({ operationId: 'op-same' }))
    const second = await application.capture(request({ operationId: 'op-same' }))
    expect(second).toEqual(first)
  })

  it('stages when affinity is uncertain (no focus signal)', async () => {
    const { application, staging } = await disposable({ focus: false })
    const receipt = await application.capture(request({
      operationId: 'op-stale-1',
      kind: 'web_link',
      payload: { type: 'url', url: 'https://example.com' },
    }))
    expect(receipt.status).toBe('staged')
    expect(receipt.stagingId).toBeDefined()
    expect(staging.countPending()).toBe(1)
  })

  it('imports a staged blob as a file artifact', async () => {
    const { application, dir, projectId } = await disposable()
    const bytes = new TextEncoder().encode('fake-png-bytes')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await mkdir(join(dir, 'blobs'), { recursive: true })
    await writeFile(join(dir, 'blobs', hash), bytes)
    const receipt = await application.capture(request({
      operationId: 'op-blob-1',
      kind: 'screenshot',
      payload: { type: 'staged_blob', blobRef: `blob:${hash}` },
    }))
    expect(receipt.status).toBe('created')
    expect(receipt.projectId).toBe(projectId)
  })
})
