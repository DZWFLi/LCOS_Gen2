import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId } from '@local-creative-os/domain'

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

function openRepository(): { readonly repository: SqliteMetadataRepository; readonly projectRoot: string } {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-project-create-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-project-create-root-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  return { repository, projectRoot }
}

async function startServer(repository: SqliteMetadataRepository): Promise<string> {
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return `http://${address.host}:${address.port}`
}

describe('Project Create', () => {
  it('creates project with root scope and default workspace, persists across reopen', () => {
    const { repository, projectRoot } = openRepository()
    repository.createProject({
      id: 'project-real-work' as ProjectId,
      name: 'Real Work',
      rootPath: projectRoot,
    })

    const project = repository.getProject('project-real-work')
    expect(project).toMatchObject({ name: 'Real Work', rootPath: projectRoot, graphVersion: 1 })

    const snapshot = repository.get('project-real-work')
    expect(snapshot?.scopes).toHaveLength(1)
    expect(snapshot?.scopes[0]).toMatchObject({ kind: 'root', name: 'Root', parentScopeId: null })
    expect(snapshot?.workspaces).toHaveLength(1)
    expect(snapshot?.workspaces[0]).toMatchObject({
      scopeId: snapshot?.scopes[0]?.id,
      name: 'Main',
      intent: null,
      visibleLayers: ['core', 'process'],
      contextPolicy: 'selection-only',
    })
    expect(snapshot?.artifacts).toHaveLength(0)

    repository.close()
    repositories.pop()

    const reopened = new SqliteMetadataRepository(repository.databasePath)
    repositories.push(reopened)
    const restored = reopened.get('project-real-work')
    expect(restored?.project.name).toBe('Real Work')
    expect(restored?.workspaces[0]?.name).toBe('Main')
  })

  it('rejects a duplicate project id', () => {
    const { repository, projectRoot } = openRepository()
    repository.createProject({ id: 'project-duplicate' as ProjectId, name: 'One', rootPath: projectRoot })
    expect(() => repository.createProject({
      id: 'project-duplicate' as ProjectId,
      name: 'Two',
      rootPath: projectRoot,
    })).toThrow(/already exists/)
  })

  it('exposes POST /projects over HTTP and lists the new entry', async () => {
    const { repository, projectRoot } = openRepository()
    const baseUrl = await startServer(repository)

    const created = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '夏季 Campaign', rootPath: projectRoot }),
    })
    expect(created.status).toBe(201)
    const createdBody = await created.json() as {
      ok: boolean
      value?: { id: string; name: string; rootPath: string; graphVersion: number }
    }
    expect(createdBody.ok).toBe(true)
    expect(createdBody.value).toMatchObject({
      name: '夏季 Campaign',
      rootPath: projectRoot,
      graphVersion: 1,
    })
    expect(createdBody.value?.id).toMatch(/^project-/)

    const listed = await fetch(`${baseUrl}/projects`)
    const listedBody = await listed.json() as {
      ok: boolean
      value: readonly { id: string; name: string; rootPath: string }[]
    }
    expect(listedBody.value).toContainEqual(expect.objectContaining({
      id: createdBody.value?.id,
      name: '夏季 Campaign',
      rootPath: projectRoot,
    }))

    const graph = await fetch(`${baseUrl}/projects/${encodeURIComponent(createdBody.value!.id)}/graph`)
    expect(graph.status).toBe(200)
    const graphBody = await graph.json() as {
      ok: boolean
      value: { project: { name: string }; scopes: readonly { kind: string }[]; workspaces: readonly { name: string }[] }
    }
    expect(graphBody.value.project.name).toBe('夏季 Campaign')
    expect(graphBody.value.scopes[0]?.kind).toBe('root')
    expect(graphBody.value.workspaces[0]?.name).toBe('Main')
  })

  it('creates one new child directory under an existing parent', async () => {
    const { repository, projectRoot } = openRepository()
    const baseUrl = await startServer(repository)
    const created = await fetch(`${baseUrl}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Work', intent: 'create', parentPath: projectRoot, directoryName: 'new-work' }),
    })
    expect(created.status).toBe(201)
    const body = await created.json() as { value: { rootPath: string } }
    expect(body.value.rootPath).toBe(join(projectRoot, 'new-work'))
    expect(repository.listProjects()).toContainEqual(expect.objectContaining({ rootPath: join(projectRoot, 'new-work') }))
  })

  it('rejects invalid creation input without writing a project', async () => {
    const { repository, projectRoot } = openRepository()
    const baseUrl = await startServer(repository)

    const missingName = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: projectRoot }),
    })
    expect(missingName.status).toBe(400)

    const missingRoot = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Root' }),
    })
    expect(missingRoot.status).toBe(400)

    const nonexistentRoot = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Root', rootPath: join(projectRoot, 'does-not-exist') }),
    })
    expect(nonexistentRoot.status).toBe(404)

    expect(repository.listProjects()).toHaveLength(0)
  })
})
