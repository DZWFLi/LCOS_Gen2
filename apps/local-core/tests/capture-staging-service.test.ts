import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-capture-staging-'))
  cleanup.push(dir)
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  repositories.push(metadata)
  const service = new CaptureStagingService(metadata, join(dir, 'blobs'))
  return { dir, metadata, service }
}

afterEach(async () => {
  // Windows 上 rm 打开中的 SQLite 文件会 hang（WAL 文件锁）；必须先 close 再删。
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('CaptureStagingService (Phase B)', () => {
  it('enqueues with payloadRef and lists recent items', async () => {
    const { service } = await disposable()
    const item = await service.enqueue({
      operationId: 'op-1',
      kind: 'screenshot',
      payloadRef: 'file:///C:/shots/1.png',
      source: { app: 'snipping-tool' },
      suggestedProjects: [{ projectId: 'project-a', score: 0.9, reason: 'recent_focus' }],
    })
    expect(item.id).toMatch(/^capture-/)
    expect(service.countPending()).toBe(1)
    const recent = service.listRecent(60_000)
    expect(recent).toHaveLength(1)
    expect(recent[0]?.payloadRef).toBe('file:///C:/shots/1.png')
  })

  it('stores payload bytes as hash-addressed blob and dedupes', async () => {
    const { dir, service } = await disposable()
    const bytes = new TextEncoder().encode('hello capture')
    const first = await service.enqueue({ operationId: 'op-b1', kind: 'file', payloadBytes: bytes, source: {} as Record<string, unknown>, suggestedProjects: [] })
    const second = await service.enqueue({ operationId: 'op-b2', kind: 'file', payloadBytes: bytes, source: {} as Record<string, unknown>, suggestedProjects: [] })
    expect(first.payloadRef).toBe(second.payloadRef)
    expect(first.payloadRef).toMatch(/^blob:/)
    const hash = first.payloadRef.replace('blob:', '')
    const blobPath = join(dir, 'blobs', hash)
    expect(await readFile(blobPath, 'utf8')).toBe('hello capture')
  })

  it('resolve assigns a project once and pending count drops', async () => {
    const { service } = await disposable()
    const item = await service.enqueue({ operationId: 'op-r1', kind: 'url', payloadRef: 'https://example.com', source: {} as Record<string, unknown>, suggestedProjects: [] })
    expect(service.resolve(item.id, 'project-a')).toBe(true)
    expect(service.resolve(item.id, 'project-b')).toBe(false)
    expect(service.countPending()).toBe(0)
    const listed = service.listRecent(60_000)
    expect(listed[0]?.resolvedProjectId).toBe('project-a')
  })

  it('persists across repository reopen (restart survives)', async () => {
    const { dir } = await disposable()
    const path = join(dir, 'metadata.sqlite')
    const first = new SqliteMetadataRepository(path)
    const service = new CaptureStagingService(first, join(dir, 'blobs'))
    await service.enqueue({ operationId: 'op-p1', kind: 'text', payloadRef: 'ref://1', source: {} as Record<string, unknown>, suggestedProjects: [] })
    first.close()
    const second = new SqliteMetadataRepository(path)
    const reopened = new CaptureStagingService(second, join(dir, 'blobs'))
    expect(reopened.countPending()).toBe(1)
    expect(reopened.listRecent(60_000)[0]?.operationId).toBe('op-p1')
  })

  it('rejects enqueue without any payload reference', async () => {
    const { service } = await disposable()
    await expect(service.enqueue({ operationId: 'op-x', kind: 'text', source: {} as Record<string, unknown>, suggestedProjects: [] })).rejects.toThrow(/payloadRef/)
  })
})
