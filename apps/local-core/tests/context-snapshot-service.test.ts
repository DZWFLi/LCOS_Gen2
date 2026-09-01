import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { ProjectId, ScopeId, WorkspaceId } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { ContextSnapshotService } from '../src/context-snapshot-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

function snapshot(): ProjectGraphSnapshot {
  const now = '2026-08-07T10:00:00.000Z'
  const projectId = 'disposable-context-snap' as ProjectGraphSnapshot['project']['id']
  const rootScopeId = 'scope-root' as ScopeId
  const workspaceId = 'workspace-main' as WorkspaceId
  return {
    schemaVersion: 20,
    graphVersion: 1,
    project: {
      id: projectId, name: 'Snap', rootPath: 'disposable://snap',
      graphVersion: 1, createdAt: now, updatedAt: now,
    },
    scopes: [
      { id: rootScopeId, projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now },
    ],
    workspaces: [{
      id: workspaceId, projectId, scopeId: rootScopeId, name: 'Main', intent: 'build',
      viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: ['view-a', 'view-b'],
      visibleLayers: ['core'], contextPolicy: 'selection-only', updatedAt: now,
    }],
    artifacts: [
      { id: 'artifact-a' as ProjectGraphSnapshot['artifacts'][number]['id'], projectId, title: 'A', kind: 'markdown', managed: true, availability: 'available', currentRevisionId: 'rev-a1', createdAt: now, updatedAt: now },
      { id: 'artifact-b' as ProjectGraphSnapshot['artifacts'][number]['id'], projectId, title: 'B', kind: 'markdown', managed: true, availability: 'available', currentRevisionId: 'rev-b1', createdAt: now, updatedAt: now },
    ],
    artifactRevisions: [
      { id: 'rev-a1' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-a', projectId, fileRecordId: 'file-a', contentHash: 'h-a', source: 'import', status: 'current', createdAt: now, updatedAt: now },
      { id: 'rev-b1' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-b', projectId, fileRecordId: 'file-b', contentHash: 'h-b', source: 'import', status: 'current', createdAt: now, updatedAt: now },
    ],
    fileRecords: [
      { id: 'file-a' as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId, observedPath: 'a.md', observedHash: 'h-a', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
      { id: 'file-b' as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId, observedPath: 'b.md', observedHash: 'h-b', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
    ],
    artifactViews: [
      { id: 'view-a' as ProjectGraphSnapshot['artifactViews'][number]['id'], artifactId: 'artifact-a', scopeId: rootScopeId, revisionId: 'rev-a1', referenceKind: 'primary', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
      { id: 'view-b' as ProjectGraphSnapshot['artifactViews'][number]['id'], artifactId: 'artifact-b', scopeId: rootScopeId, revisionId: 'rev-b1', referenceKind: 'primary', position: { x: 300, y: 0 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
    ],
    relations: [],
    notes: [],
    checkpoints: [],
  }
}

describe('ContextSnapshotService', () => {
  it('creates, lists, compares and branches context snapshots (B5)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-context-snapshot-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(snapshot())
    const projectId = 'disposable-context-snap' as ProjectId
    const workspaceId = 'workspace-main' as WorkspaceId
    let counter = 0
    const service = new ContextSnapshotService(repository, () => `snap-${++counter}`)

    const first = service.create(projectId, 'v1', workspaceId, '2026-08-07T10:00:00.000Z')
    expect(first.label).toBe('v1')
    const refs = first.snapshotJson as unknown as { focusedViewIds: string[]; artifactIds: string[] }
    expect(refs.focusedViewIds).toEqual(expect.arrayContaining(['view-a', 'view-b']))
    expect(refs.artifactIds).toEqual(expect.arrayContaining(['artifact-a', 'artifact-b']))

    // Change workspace focus and create v2
    repository.applyMutations({
      baseVersion: 1,
      ops: [{ type: 'update_workspace_presentation', workspaceId, focusedViewIds: ['view-b'], visibleLayers: ['core'] }],
    }, projectId)
    const second = service.create(projectId, 'v2', workspaceId, '2026-08-07T10:05:00.000Z')

    const listed = service.list(projectId, workspaceId)
    expect(listed.map((checkpoint) => checkpoint.label)).toEqual(expect.arrayContaining(['v1', 'v2']))

    const compared = service.compare(projectId, first.id, second.id)
    expect(compared.added.focusedViewIds).toEqual([])
    expect(compared.removed.focusedViewIds).toEqual(['view-a'])
    expect(compared.kept.focusedViewIds).toEqual(['view-b'])

    const branched = service.branch(projectId, first.id, 'Snapshot Branch')
    const graph = repository.get(projectId)
    const branchScope = graph?.scopes.find((scope) => scope.id === branched.scopeId)
    expect(branchScope?.kind).toBe('collection')
    const branchViews = graph?.artifactViews.filter((view) => view.scopeId === branched.scopeId)
    expect(branchViews?.map((view) => view.artifactId)).toEqual(expect.arrayContaining(['artifact-a', 'artifact-b']))
    // Original artifacts are not copied
    expect(graph?.artifacts.filter((artifact) => artifact.title === 'A').length).toBe(1)
  })
})
