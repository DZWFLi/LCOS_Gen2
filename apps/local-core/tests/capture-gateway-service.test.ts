import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { CaptureGatewayError, CaptureGatewayService } from '../src/capture-gateway-service.js'
import type { CaptureApplicationService } from '../src/capture-application-service.js'
import type { CaptureStagingService } from '../src/capture-staging-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { RuntimeRegistryService } from '../src/runtime-registry-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

function snapshot(): ProjectGraphSnapshot {
  const now = '2026-08-12T00:00:00.000Z'
  const projectId = 'disposable-gateway' as ProjectGraphSnapshot['project']['id']
  return {
    schemaVersion: 33,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: { id: projectId, name: 'Gateway Fixture', rootPath: 'disposable://gateway', graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'], createdAt: now, updatedAt: now },
    scopes: [{ id: 'scope-root', projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [],
    artifacts: [],
    artifactViews: [],
    artifactRevisions: [],
    fileRecords: [],
    relations: [],
    notes: [],
    checkpoints: [],
  }
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-gateway-'))
  cleanup.push(directory)
  process.env.LCOS_RUNTIME_REGISTRY = join(directory, 'registry.json')
  const metadata = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repositories.push(metadata)
  metadata.save(snapshot())
  const registry = new RuntimeRegistryService()
  const token = registry.ensureExtensionToken()
  const captured: { kind?: string; payloadType?: string; projectId?: string }[] = []
  const staged: string[] = []
  const capture = {
    capture: async (input: { operationId: string; kind: string; targetHint?: { projectId?: string }; payload: { type: string } }) => {
      captured.push({ kind: input.kind, payloadType: input.payload.type, projectId: input.targetHint?.projectId })
      return { operationId: input.operationId, status: 'created' as const, projectId: input.targetHint?.projectId ?? 'disposable-gateway' }
    },
  } as unknown as CaptureApplicationService
  const staging = {
    enqueue: async (input: { operationId: string; kind: string }) => {
      staged.push(input.kind)
      return { id: `capture-${input.operationId}`, operationId: input.operationId, kind: input.kind, payloadRef: 'ref', source: {}, suggestedProjects: [], capturedAt: new Date().toISOString() }
    },
  } as unknown as CaptureStagingService
  const gateway = new CaptureGatewayService(capture, staging, registry, metadata, join(directory, 'blobs'))
  return { gateway, token, captured, staged, metadata }
}

describe('Phase 5 Slice 1 — capture/v1 gateway', () => {
  afterEach(async () => {
    delete process.env.LCOS_RUNTIME_REGISTRY
    // Windows 上 rm 打开中的 SQLite 文件会 hang（WAL 文件锁）；必须先 close 再删。
    for (const repository of repositories.splice(0)) {
      try { repository.close() } catch { /* already closed */ }
    }
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('rejects missing or invalid gateway tokens', async () => {
    const { gateway } = await createFixture()
    await expect(gateway.submit({}, {})).rejects.toMatchObject({ status: 401 })
    await expect(gateway.submit({}, { token: 'wrong' })).rejects.toMatchObject({ status: 401 })
  })

  it('rejects non-loopback origins', async () => {
    const { gateway, token } = await createFixture()
    await expect(gateway.submit({}, { token, origin: 'https://evil.example' })).rejects.toMatchObject({ status: 403 })
  })

  it('accepts MV3 extension origins (chrome-extension://)', async () => {
    const { gateway, token, staged } = await createFixture()
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-ext', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'text' }, content: { text: 'from extension' }, target: { mode: 'staging' },
    }, { token, origin: 'chrome-extension://dlkmkfeibcehakfpmeehmihedehkodfb' })
    expect(staged).toEqual(['clipboard_text'])
    expect(result.destination).toBe('staging')
  })

  it('lets the authenticated Desktop Runtime Host reuse the gateway without an extension token', async () => {
    const { gateway, staged } = await createFixture()
    const result = await gateway.submitTrusted({
      schemaVersion: 1, operationId: 'o-desktop', capturedAt: '2026-08-18T00:00:00.000Z',
      source: { kind: 'text', pageTitle: 'Desktop capture' }, content: { text: 'captured from float' }, target: { mode: 'staging' },
    })
    expect(staged).toEqual(['clipboard_text'])
    expect(result.destination).toBe('staging')
  })

  it('accepts local file capture only through the trusted Runtime Host channel', async () => {
    const { gateway, token } = await createFixture()
    await expect(gateway.submit({
      schemaVersion: 1, operationId: 'o-file-untrusted', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'file', localPath: 'C:\\tmp\\shot.png' }, target: { mode: 'staging' },
    }, { token })).rejects.toMatchObject({ status: 403 })
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-file-trusted', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'file', localPath: 'C:\\tmp\\shot.png' }, target: { mode: 'staging' },
    }, { token, trusted: true })
    expect(result.destination).toBe('staging')
  })

  it('validates schema, kind and required content', async () => {
    const { gateway, token } = await createFixture()
    await expect(gateway.submit({ schemaVersion: 2 }, { token, origin: 'http://127.0.0.1:5173' })).rejects.toMatchObject({ status: 400 })
    await expect(gateway.submit({ schemaVersion: 1, operationId: 'o1', capturedAt: 'now', source: { kind: 'page' }, target: { mode: 'auto' } }, { token })).rejects.toMatchObject({ status: 400 })
    await expect(gateway.submit({ schemaVersion: 1, operationId: 'o1', capturedAt: 'now', source: { kind: 'nope' }, target: { mode: 'auto' } }, { token })).rejects.toMatchObject({ status: 400 })
    await expect(gateway.submit({ schemaVersion: 1, operationId: 'o1', capturedAt: 'now', source: { kind: 'image' }, target: { mode: 'auto' } }, { token })).rejects.toMatchObject({ status: 400 })
  })

  it('routes text to auto capture and reports the project label', async () => {
    const { gateway, token, captured } = await createFixture()
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-text', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'text' }, content: { text: 'hello' }, target: { mode: 'auto' },
    }, { token })
    expect(captured[0]).toMatchObject({ kind: 'clipboard_text', payloadType: 'text' })
    expect(result.destination).toBe('project')
    expect(result.destinationLabel).toBe('Gateway Fixture')
  })

  it('forces staging mode without touching capture affinity', async () => {
    const { gateway, token, captured, staged } = await createFixture()
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-stage', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'link', sourceUrl: 'https://example.com' }, target: { mode: 'staging' },
    }, { token })
    expect(captured).toHaveLength(0)
    expect(staged).toEqual(['web_link'])
    expect(result.destination).toBe('staging')
  })

  it('replays an existing staging operationId idempotently', async () => {
    const { gateway, token, metadata, staged } = await createFixture()
    metadata.saveCaptureReceipt({ operationId: 'o-replay', status: 'staged', stagingId: 'capture-existing' })
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-replay', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'text' }, content: { text: 'again' }, target: { mode: 'staging' },
    }, { token })
    expect(staged).toHaveLength(0)
    expect(result.receipt.stagingId).toBe('capture-existing')
  })

  it('targets an explicit project and rejects missing ones', async () => {
    const { gateway, token, captured } = await createFixture()
    const result = await gateway.submit({
      schemaVersion: 1, operationId: 'o-project', capturedAt: '2026-08-12T00:00:00.000Z',
      source: { kind: 'page', pageUrl: 'https://example.com' }, target: { mode: 'project', projectId: 'disposable-gateway' },
    }, { token })
    expect(captured[0]?.projectId).toBe('disposable-gateway')
    expect(result.destinationLabel).toBe('Gateway Fixture')
    await expect(gateway.submit({
      schemaVersion: 1, operationId: 'o-missing', capturedAt: 'now', source: { kind: 'page', pageUrl: 'https://example.com' }, target: { mode: 'project', projectId: 'missing' },
    }, { token })).rejects.toMatchObject({ status: 404 })
  })
})
