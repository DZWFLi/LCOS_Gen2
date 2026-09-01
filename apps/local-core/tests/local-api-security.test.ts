import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function startServer(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-local-api-security-'))
  roots.push(root)
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  const server = createLocalCoreServer({
    port: 0,
    metadataRepository: repository,
    apiToken: 'test-local-token',
  })
  servers.push(server)
  const address = await server.start()
  return `http://${address.host}:${address.port}`
}

describe('Local API security boundary', () => {
  it('keeps health available but requires the startup bearer token elsewhere', async () => {
    const baseUrl = await startServer()
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/projects`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/projects`, {
      headers: { authorization: 'Bearer wrong' },
    })).status).toBe(401)
    expect((await fetch(`${baseUrl}/projects`, {
      headers: { authorization: 'Bearer test-local-token' },
    })).status).toBe(200)
  })

  it('rejects non-allowlisted browser origins before authorization', async () => {
    const baseUrl = await startServer()
    const response = await fetch(`${baseUrl}/projects`, {
      headers: {
        authorization: 'Bearer test-local-token',
        origin: 'https://attacker.example',
      },
    })
    expect(response.status).toBe(403)
  })
})
