import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function startServer(): Promise<{ readonly baseUrl: string; readonly projectId: string; readonly scopeId: string }> {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-pkg-http-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-pkg-http-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'project-pkg-http' as ProjectId, name: 'Pkg HTTP', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, projectId: 'project-pkg-http', scopeId: String(repository.get('project-pkg-http')!.scopes[0]!.id) }
}

describe('Resource package HTTP routes (U3)', () => {
  it('preserves UTF-8 PDF filenames and exposes project-scoped read-only content', async () => {
    const { baseUrl, projectId, scopeId } = await startServer()
    const pdf = Buffer.from('%PDF-1.4\nLCOS preview test\n%%EOF', 'utf8')
    const form = new FormData()
    form.set('file', new Blob([pdf], { type: 'application/pdf' }), '中文提案.pdf')
    form.set('importRequestId', 'pdf-utf8-1')
    form.set('scopeId', scopeId)
    form.set('position.x', '20')
    form.set('position.y', '30')

    const imported = await fetch(`${baseUrl}/projects/${projectId}/imports`, { method: 'POST', body: form })
    expect(imported.status).toBe(201)
    const importedBody = await imported.json() as { value: { revision: { fileRecordId: string }; artifact: { title: string } } }
    expect(importedBody.value.artifact.title).toBe('中文提案.pdf')

    const content = await fetch(`${baseUrl}/projects/${projectId}/file-records/${importedBody.value.revision.fileRecordId}/content`)
    expect(content.status).toBe(200)
    expect(content.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await content.arrayBuffer())).toEqual(pdf)
  })

  it('imports a directory through a resumable raw-byte session and lists it', async () => {
    const { baseUrl, projectId, scopeId } = await startServer()
    const started = await fetch(`${baseUrl}/projects/${projectId}/resource-upload-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        importRequestId: 'dir-1', rootName: 'skill-a', scopeId, x: 10, y: 20,
      }),
    })
    const session = await started.json() as { value: { sessionId: string } }
    for (const [path, content] of [['skill-a/SKILL.md', '# Skill A'], ['skill-a/scripts/run.js', 'console.log(1)']]) {
      const uploaded = await fetch(`${baseUrl}/projects/${projectId}/resource-upload-sessions/${session.value.sessionId}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body: content })
      expect(uploaded.status).toBe(200)
    }
    const response = await fetch(`${baseUrl}/projects/${projectId}/resource-upload-sessions/${session.value.sessionId}/complete`, { method: 'POST' })
    expect(response.status).toBe(201)
    const body = await response.json() as { ok: boolean; value?: { resourceId: string; sourceKind: string } }
    expect(body.value?.sourceKind).toBe('directory_copy')

    const listed = await fetch(`${baseUrl}/projects/${projectId}/resources`)
    const listedBody = await listed.json() as { ok: boolean; value: readonly { resourceId: string; title: string }[] }
    expect(listedBody.value).toContainEqual(expect.objectContaining({ resourceId: body.value!.resourceId, title: 'skill-a' }))
  })

  it('rejects the legacy base64 directory endpoint', async () => {
    const { baseUrl, projectId } = await startServer()
    const response = await fetch(`${baseUrl}/projects/${projectId}/resources/import-directory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(410)
  })

  it('imports a ZIP archive via multipart', async () => {
    const { baseUrl, projectId } = await startServer()
    const zip = Buffer.from('PK\u0005\u0006', 'utf8')
    const form = new FormData()
    form.set('file', new Blob([zip]), 'pkg.zip')
    form.set('importRequestId', 'zip-http-1')
    form.set('scopeId', 'scope-root')
    form.set('position.x', '10')
    form.set('position.y', '20')
    const response = await fetch(`${baseUrl}/projects/${projectId}/resources/import-archive`, {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { error?: { message: string } }
    expect(body.error?.message).toContain('EOCD')
  })
})
