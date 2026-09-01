import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []

function snapshotFor(projectId: string): ProjectGraphSnapshot {
  const now = '2026-08-11T00:00:00.000Z'
  const scopeId = 'scope-root'
  const artifactId = 'artifact-1'
  const viewId = 'view-artifact-1'
  const revisionId = 'revision-1'
  const fileRecordId = 'file-1'
  return {
    schemaVersion: 32,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: {
      id: projectId as ProjectGraphSnapshot['project']['id'],
      name: `Project ${projectId}`,
      rootPath: `probe://${projectId}`,
      graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'],
      createdAt: now,
      updatedAt: now,
    },
    scopes: [{ id: scopeId as ProjectGraphSnapshot['scopes'][number]['id'], projectId: projectId as ProjectGraphSnapshot['scopes'][number]['projectId'], parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [{ id: 'workspace-main' as ProjectGraphSnapshot['workspaces'][number]['id'], projectId: projectId as ProjectGraphSnapshot['workspaces'][number]['projectId'], scopeId: scopeId as ProjectGraphSnapshot['workspaces'][number]['scopeId'], name: 'Main', intent: 'build', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'selection-only', updatedAt: now }],
    artifacts: [{ id: artifactId as ProjectGraphSnapshot['artifacts'][number]['id'], projectId: projectId as ProjectGraphSnapshot['artifacts'][number]['projectId'], title: 'A', kind: 'text', availability: 'available', currentRevisionId: revisionId as ProjectGraphSnapshot['artifacts'][number]['currentRevisionId'], createdAt: now, updatedAt: now }],
    fileRecords: [{ id: fileRecordId as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId: projectId as ProjectGraphSnapshot['fileRecords'][number]['projectId'], observedPath: `probe://${projectId}/a.md`, observedHash: 'hash-a', size: 10, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now }],
    artifactRevisions: [{ id: revisionId as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: artifactId as ProjectGraphSnapshot['artifactRevisions'][number]['artifactId'], fileRecordId: fileRecordId as ProjectGraphSnapshot['artifactRevisions'][number]['fileRecordId'], contentHash: 'hash-a' as ProjectGraphSnapshot['artifactRevisions'][number]['contentHash'], source: 'import', status: 'current', createdAt: now }],
    artifactViews: [{ id: viewId as ProjectGraphSnapshot['artifactViews'][number]['id'], artifactId: artifactId as ProjectGraphSnapshot['artifactViews'][number]['artifactId'], revisionId: revisionId as ProjectGraphSnapshot['artifactViews'][number]['revisionId'], scopeId: scopeId as ProjectGraphSnapshot['artifactViews'][number]['scopeId'], referenceKind: 'primary', position: { x: 10, y: 10 }, size: { width: 180, height: 60 }, displayMode: 'card', collapsed: false }],
    relations: [{ id: 'relation-1' as ProjectGraphSnapshot['relations'][number]['id'], projectId: projectId as ProjectGraphSnapshot['relations'][number]['projectId'], sourceEntityType: 'artifact', sourceEntityId: artifactId as ProjectGraphSnapshot['relations'][number]['sourceEntityId'], targetEntityType: 'artifact', targetEntityId: artifactId as ProjectGraphSnapshot['relations'][number]['targetEntityId'], kind: 'informs', createdAt: now, updatedAt: now }],
    notes: [],
    checkpoints: [],
  }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('cross-project primary-key ownership guard', () => {
  it('rejects a snapshot whose ids already belong to another project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-id-guard-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(snapshotFor('project-alpha'))

    expect(() => repository.save(snapshotFor('project-beta'))).toThrow(/already belongs to project project-alpha/)

    // Project A 数据不被覆盖；Project B 保持为空（不产生半写）。
    const alpha = repository.get('project-alpha')
    expect(alpha?.artifacts).toHaveLength(1)
    expect(alpha?.scopes).toHaveLength(1)
    expect(alpha?.artifactViews).toHaveLength(1)
    // 事务整体回滚：Project B 不残留半写（连项目行都没有）。
    expect(repository.get('project-beta')).toBeUndefined()
    repository.close()
  })

  it('allows idempotent re-save within the same project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-id-guard-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(snapshotFor('project-alpha'))
    expect(() => repository.save(snapshotFor('project-alpha'))).not.toThrow()
    expect(repository.get('project-alpha')?.artifacts).toHaveLength(1)
    repository.close()
  })

  it('rejects cross-project id theft through mutation ops too', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-id-guard-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(snapshotFor('project-alpha'))
    repository.createProject({ id: 'project-beta' as ProjectGraphSnapshot['project']['id'], name: 'Beta', rootPath: 'probe://beta' })

    expect(() => repository.applyMutations({
      baseVersion: 1 as ProjectGraphSnapshot['graphVersion'],
      ops: [{
        type: 'upsert_artifact',
        artifact: snapshotFor('project-beta').artifacts[0] as ProjectGraphSnapshot['artifacts'][number],
      }],
    }, 'project-beta')).toThrow(/already belongs to project project-alpha/)
    repository.close()
  })
})
