import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const servers: LocalCoreServer[] = []
const repositories: SqliteMetadataRepository[] = []
const roots: string[] = []
const controllers: AbortController[] = []

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort()
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await new Promise((resolve) => setTimeout(resolve, 50))
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
  for (const repository of repositories.splice(0)) repository.close()
})

async function startServer(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-sse-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'sse-project' as never, name: 'SSE', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return `http://${address.host}:${address.port}`
}

describe('S6 SSE event subscription (ProjectEventHub -> text/event-stream)', () => {
  it('opens an SSE stream and emits a snapshot frame, then closes cleanly', async () => {
    const baseUrl = await startServer()
    const controller = new AbortController()
    controllers.push(controller)
    const response = await fetch(`${baseUrl}/projects/sse-project/events`, { method: 'GET', signal: controller.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawSnapshot = false
    for (let i = 0; i < 20; i++) {
      const { value, done } = await reader!.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.includes('event: snapshot')) { sawSnapshot = true; break }
    }
    expect(sawSnapshot).toBe(true)
    expect(buffer).toContain('runtimeId')

    controller.abort()
    try { await reader!.cancel() } catch { /* best effort */ }
  })
})