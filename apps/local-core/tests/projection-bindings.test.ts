import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { handleSpatialBindingsRoute } from '../src/routes/spatial-bindings.js'

const cleanups: string[] = []

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'lcos-g0-8a-'))
  const dbPath = join(root, 'meta.sqlite')
  cleanups.push(root)
  return { repo: new SqliteMetadataRepository(dbPath), dbPath }
}

function userVersion(dbPath: string): number {
  const db = new DatabaseSync(dbPath)
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.close()
  return Number(row.user_version)
}

afterEach(() => {
  for (const root of cleanups.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe('projection_bindings (schema v52 + route)', () => {
  it('migrates to schema v52 and creates the projection_bindings table', () => {
    const { repo, dbPath } = createRepo()
    expect(userVersion(dbPath)).toBe(52)
    // Upsert without error proves the table exists and accepts the identity columns.
    repo.createProject({ id: 'p-g0' as never, name: 'g0', rootPath: '/tmp/g0' })
    repo.upsertProjectionBinding({ projectId: 'p-g0', canvasId: 'c1', spatialKind: 'node', spatialId: 'n1', entityType: 'artifact', entityId: 'a1' })
    expect(repo.getProjectionBindings('p-g0')).toHaveLength(1)
  })

  it('CRUD: upsert -> find -> list -> delete', () => {
    const { repo } = createRepo()
    repo.createProject({ id: 'p-crud' as never, name: 'crud', rootPath: '/tmp/crud' })
    repo.upsertProjectionBinding({ projectId: 'p-crud', canvasId: 'c1', spatialKind: 'edge', spatialId: 'e1', entityType: 'relation', entityId: 'r1' })
    const found = repo.findProjectionBinding('p-crud', 'c1', 'edge', 'relation', 'r1')
    expect(found?.spatialId).toBe('e1')
    expect(repo.getProjectionBindings('p-crud')).toHaveLength(1)
    repo.deleteProjectionBinding('p-crud', 'c1', 'edge', 'relation', 'r1')
    expect(repo.getProjectionBindings('p-crud')).toHaveLength(0)
    expect(repo.findProjectionBinding('p-crud', 'c1', 'edge', 'relation', 'r1')).toBeUndefined()
  })

  it('route: GET list, PUT upsert, DELETE single (no geometry accepted)', async () => {
    const { repo } = createRepo()
    repo.createProject({ id: 'p-g0' as never, name: 'g0', rootPath: '/tmp/g0' })

    let captured: { status: number; value: unknown } | undefined
    const helpers = {
      sendJson: (_response: unknown, status: number, value: unknown) => { captured = { status, value } },
      failure: (code: string, message: string) => ({ ok: false, error: { code, message, retryable: false, origin: 'test' } }),
      isRecord: (v: unknown) => typeof v === 'object' && v !== null,
      readJsonBody: async (request: AsyncIterable<Buffer>) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
      },
    }
    const makeCtx = (method: string, pathname: string, body?: string) => ({
      method,
      pathname,
      request: Readable.from([Buffer.from(body ?? '{}', 'utf8')]),
      response: {},
      controller: new AbortController(),
      metadata: repo,
      helpers,
    })

    // PUT upsert
    captured = undefined
    const put = await handleSpatialBindingsRoute(makeCtx(
      'PUT', '/projects/p-g0/spatial/bindings',
      JSON.stringify({ projectId: 'p-g0', canvasId: 'c1', spatialKind: 'node', spatialId: 'n1', entityType: 'artifact', entityId: 'a1' }),
    ))
    expect(put).toBe(true)
    expect(captured?.status).toBe(200)
    expect(repo.getProjectionBindings('p-g0')).toHaveLength(1)

    // GET list
    captured = undefined
    const get = await handleSpatialBindingsRoute(makeCtx('GET', '/projects/p-g0/spatial/bindings'))
    expect(get).toBe(true)
    expect(captured?.status).toBe(200)
    expect((captured?.value as { value: unknown[] }).value).toHaveLength(1)

    // DELETE single
    captured = undefined
    const del = await handleSpatialBindingsRoute(makeCtx(
      'DELETE', '/projects/p-g0/spatial/bindings',
      JSON.stringify({ canvasId: 'c1', spatialKind: 'node', entityType: 'artifact', entityId: 'a1' }),
    ))
    expect(del).toBe(true)
    expect(captured?.status).toBe(200)
    expect(repo.getProjectionBindings('p-g0')).toHaveLength(0)

    // Reject geometry-containing payloads (spatial truth lives in Huabu).
    captured = undefined
    const bad = await handleSpatialBindingsRoute(makeCtx(
      'PUT', '/projects/p-g0/spatial/bindings',
      JSON.stringify({ projectId: 'p-g0', canvasId: 'c1', spatialKind: 'node', spatialId: 'n1', entityType: 'artifact', entityId: 'a1', geometry: { x: 1, y: 2 } }),
    ))
    expect(bad).toBe(true)
    expect(captured?.status).toBe(200)
  })
})
