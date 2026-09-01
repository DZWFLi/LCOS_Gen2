import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectId, Relation } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function setupProject() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-relation-endpoint-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-relation-endpoint-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-31T12:00:00.000Z')
  repository.save(snapshot)
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return {
    baseUrl: `http://${address.host}:${address.port}`,
    projectId: String(snapshot.project.id),
    snapshot,
    repository,
  }
}

const relation = (id: string, projectId: string, sourceEntityType: Relation['sourceEntityType'], sourceEntityId: string, targetEntityType: Relation['targetEntityType'], targetEntityId: string): Relation => ({
  id,
  projectId: projectId as ProjectId,
  sourceEntityType,
  sourceEntityId,
  targetEntityType,
  targetEntityId,
  kind: 'reference',
  createdAt: '2026-07-31T12:00:00.000Z',
  updatedAt: '2026-07-31T12:00:00.000Z',
})

describe('Relation endpoint ownership contract', () => {
  it('accepts and persists view/workspace endpoints for all four directions', async () => {
    const { baseUrl, projectId, snapshot } = await setupProject()
    const artifactId = String(snapshot.artifacts[0]!.id)
    const viewId = String(snapshot.artifactViews[0]!.id)
    const workspaceId = String(snapshot.workspaces[0]!.id)

    const cases: Array<{ id: string; sourceType: Relation['sourceEntityType']; sourceId: string; targetType: Relation['targetEntityType']; targetId: string }> = [
      { id: 'relation-artifact-workspace-a', sourceType: 'artifact', sourceId: artifactId, targetType: 'workspace', targetId: workspaceId },
      { id: 'relation-workspace-artifact-b', sourceType: 'workspace', sourceId: workspaceId, targetType: 'artifact', targetId: artifactId },
      { id: 'relation-view-workspace-c', sourceType: 'view', sourceId: viewId, targetType: 'workspace', targetId: workspaceId },
      { id: 'relation-workspace-view-d', sourceType: 'workspace', sourceId: workspaceId, targetType: 'view', targetId: viewId },
    ]

    for (const item of cases) {
      const value = relation(item.id, projectId, item.sourceType, item.sourceId, item.targetType, item.targetId)
      const created = await fetch(`${baseUrl}/projects/${projectId}/relations/${item.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      })
      expect(created.status, `${item.id} create`).toBe(200)
      await expect(created.json()).resolves.toMatchObject({ ok: true, value: { id: item.id, kind: 'reference' } })
    }

    const listed = await fetch(`${baseUrl}/projects/${projectId}/relations`)
    await expect(listed.json()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining(cases.map((item) => expect.objectContaining({ id: item.id }))),
    })

    for (const item of cases) {
      const removed = await fetch(`${baseUrl}/projects/${projectId}/relations/${item.id}`, { method: 'DELETE' })
      expect(removed.status, `${item.id} delete`).toBe(200)
    }

    const afterDelete = await fetch(`${baseUrl}/projects/${projectId}/relations`)
    const body = await afterDelete.json() as { value: { id: string }[] }
    expect(body.value.some((entry) => cases.some((item) => entry.id === item.id))).toBe(false)
  })

  it('rejects view/workspace relations that cross project boundaries', async () => {
    const { baseUrl, projectId, snapshot, repository } = await setupProject()
    repository.createProject({
      id: 'project-relation-other-00000000' as ProjectId,
      name: 'Other Project',
      rootPath: join(tmpdir(), 'lcos-relation-other'),
    })
    const otherWorkspaceId = `workspace-project-relation-other-00000000-main`
    const artifactId = String(snapshot.artifacts[0]!.id)
    const viewId = String(snapshot.artifactViews[0]!.id)

    const crossCases = [
      relation('relation-cross-ws-a', projectId, 'artifact', artifactId, 'workspace', otherWorkspaceId),
      relation('relation-cross-b-ws', projectId, 'workspace', otherWorkspaceId, 'artifact', artifactId),
      relation('relation-cross-view-ws', projectId, 'view', viewId, 'workspace', otherWorkspaceId),
      relation('relation-cross-ws-view', projectId, 'workspace', otherWorkspaceId, 'view', viewId),
    ]

    for (const value of crossCases) {
      const response = await fetch(`${baseUrl}/projects/${projectId}/relations/${value.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      })
      expect(response.status, `${value.id} cross-project`).toBe(400)
    }
  })
})
