import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []
const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input)
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(input, init)
    throw new TypeError('network disabled in tests')
  }))
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
  vi.unstubAllGlobals()
})

async function startServer(): Promise<{ readonly baseUrl: string; readonly projectId: string }> {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-resource-http-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-resource-http-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({
    id: 'project-resource-http' as ProjectId,
    name: 'Resource HTTP',
    rootPath: projectRoot,
  })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, projectId: 'project-resource-http' }
}

describe('Resource HTTP routes (U1)', () => {
  it('imports a URL, lists it, reads descriptor and reanalyzes', async () => {
    const { baseUrl, projectId } = await startServer()

    const imported = await fetch(`${baseUrl}/projects/${projectId}/resources/import-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/script', title: '示例脚本' }),
    })
    expect(imported.status).toBe(201)
    const importedBody = await imported.json() as {
      ok: boolean
      value?: { resourceId: string; sourceKind: string; understandingStatus: string }
    }
    expect(importedBody.ok).toBe(true)
    expect(importedBody.value?.sourceKind).toBe('link')
    expect(importedBody.value?.understandingStatus).toBe('pending')
    const resourceId = importedBody.value!.resourceId

    const listed = await fetch(`${baseUrl}/projects/${projectId}/resources`)
    expect(listed.status).toBe(200)
    const listedBody = await listed.json() as { ok: boolean; value: readonly { resourceId: string; title: string; status: string }[] }
    expect(listedBody.value).toContainEqual(expect.objectContaining({ resourceId, title: '示例脚本' }))

    const descriptor = await fetch(`${baseUrl}/projects/${projectId}/resources/${resourceId}/descriptor`)
    expect(descriptor.status).toBe(200)
    const descriptorBody = await descriptor.json() as { ok: boolean; value: { source: { domain?: string }; understanding: { status: string } } }
    expect(descriptorBody.value.source.domain).toBe('example.com')
    expect(['pending', 'partial', 'ready']).toContain(descriptorBody.value.understanding.status)

    const reanalyzed = await fetch(`${baseUrl}/projects/${projectId}/resources/${resourceId}/reanalyze`, { method: 'POST' })
    expect(reanalyzed.status).toBe(200)
    const reanalyzedBody = await reanalyzed.json() as { ok: boolean; value: { understanding: { status: string; analyzerVersion: string } } }
    expect(['ready', 'partial']).toContain(reanalyzedBody.value.understanding.status)
    expect(reanalyzedBody.value.understanding.analyzerVersion).toMatch(/v0$/)
  })

  it('rejects unsafe URL over HTTP with 400 and does not create a resource', async () => {
    const { baseUrl, projectId } = await startServer()
    const response = await fetch(`${baseUrl}/projects/${projectId}/resources/import-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:43121/health' }),
    })
    expect(response.status).toBe(400)

    const listed = await fetch(`${baseUrl}/projects/${projectId}/resources`)
    const listedBody = await listed.json() as { ok: boolean; value: readonly unknown[] }
    expect(listedBody.value).toHaveLength(0)
  })
})
