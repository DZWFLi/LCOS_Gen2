import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { ArtifactViewId, ProjectId, ScopeId } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { WorkbenchService } from '../src/workbench-service.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

function snapshot(): ProjectGraphSnapshot {
  const now = '2026-08-07T09:00:00.000Z'
  const projectId = 'disposable-workbench' as ProjectGraphSnapshot['project']['id']
  const rootScopeId = 'scope-root' as ScopeId
  const benchScopeId = 'workbench-temp' as ScopeId
  return {
    schemaVersion: 20,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: {
      id: projectId, name: 'Workbench', rootPath: 'disposable://workbench',
      graphVersion: 1, createdAt: now, updatedAt: now,
    },
    scopes: [
      { id: rootScopeId, projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now },
      { id: benchScopeId, projectId, parentScopeId: rootScopeId, containerViewId: null, kind: 'temporary-workbench', name: '当前现场', createdAt: now, updatedAt: now },
    ],
    workspaces: [],
    artifacts: [
      { id: 'artifact-a' as ProjectGraphSnapshot['artifacts'][number]['id'], projectId, title: 'A', kind: 'markdown', managed: true, availability: 'available', currentRevisionId: 'rev-a1', createdAt: now, updatedAt: now },
      { id: 'artifact-b' as ProjectGraphSnapshot['artifacts'][number]['id'], projectId, title: 'B', kind: 'markdown', managed: true, availability: 'available', currentRevisionId: 'rev-b1', createdAt: now, updatedAt: now },
      { id: 'artifact-c' as ProjectGraphSnapshot['artifacts'][number]['id'], projectId, title: 'C', kind: 'image', managed: true, availability: 'available', currentRevisionId: 'rev-c1', createdAt: now, updatedAt: now },
    ],
    artifactRevisions: [
      { id: 'rev-a1' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-a', projectId, fileRecordId: 'file-a', contentHash: 'h-a', source: 'import', status: 'current', createdAt: now, updatedAt: now },
      { id: 'rev-a0' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-a', projectId, fileRecordId: 'file-a', contentHash: 'h-a0', source: 'import', status: 'historical', createdAt: now, updatedAt: now },
      { id: 'rev-b1' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-b', projectId, fileRecordId: 'file-b', contentHash: 'h-b', source: 'import', status: 'current', createdAt: now, updatedAt: now },
      { id: 'rev-c1' as ProjectGraphSnapshot['artifactRevisions'][number]['id'], artifactId: 'artifact-c', projectId, fileRecordId: 'file-c', contentHash: 'h-c', source: 'import', status: 'current', createdAt: now, updatedAt: now },
    ],
    fileRecords: [
      { id: 'file-a' as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId, observedPath: 'a.md', observedHash: 'h-a', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
      { id: 'file-b' as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId, observedPath: 'b.md', observedHash: 'h-b', size: 1, modifiedAt: now, mimeType: 'text/markdown', availability: 'current', observedAt: now },
      { id: 'file-c' as ProjectGraphSnapshot['fileRecords'][number]['id'], projectId, observedPath: 'c.png', observedHash: 'h-c', size: 1, modifiedAt: now, mimeType: 'image/png', availability: 'current', observedAt: now },
    ],
    artifactViews: [
      // Root already references A (canonical) and C.
      { id: 'view-a-root' as ArtifactViewId, artifactId: 'artifact-a', scopeId: rootScopeId, revisionId: 'rev-a1', referenceKind: 'primary', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
      { id: 'view-c-root' as ArtifactViewId, artifactId: 'artifact-c', scopeId: rootScopeId, revisionId: 'rev-c1', referenceKind: 'primary', position: { x: 300, y: 0 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
      // Workbench references: A (dup), B (new stable), A at historical revision (not stable).
      { id: 'view-a-bench' as ArtifactViewId, artifactId: 'artifact-a', scopeId: benchScopeId, revisionId: 'rev-a1', referenceKind: 'primary', position: { x: 10, y: 10 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
      { id: 'view-b-bench' as ArtifactViewId, artifactId: 'artifact-b', scopeId: benchScopeId, revisionId: 'rev-b1', referenceKind: 'primary', position: { x: 20, y: 20 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
      { id: 'view-a-historical-bench' as ArtifactViewId, artifactId: 'artifact-a', scopeId: benchScopeId, revisionId: 'rev-a0', referenceKind: 'primary', position: { x: 30, y: 30 }, size: { width: 200, height: 100 }, displayMode: 'card', collapsed: false },
    ],
    relations: [],
    notes: [],
    checkpoints: [],
  }
}

describe('WorkbenchService', () => {
  it('merges stable views into root, reuses canonical refs, drops historical, keeps runs untouched (B4)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-workbench-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(snapshot())
    const projectId = 'disposable-workbench' as ProjectId

    const service = new WorkbenchService(repository, () => 'view-new-b')
    const result = service.merge(projectId, 'workbench-temp' as ScopeId)

    expect(result.mergedViews).toBe(1)
    expect(result.restoredRefs).toBe(2)
    expect(result.removedViews).toBe(3)

    const graph = repository.get(projectId)
    const rootViews = graph?.artifactViews.filter((view) => view.scopeId === 'scope-root')
    const benchViews = graph?.artifactViews.filter((view) => view.scopeId === 'workbench-temp')
    expect(benchViews).toHaveLength(0)
    expect(rootViews?.some((view) => view.id === 'view-new-b' && view.artifactId === 'artifact-b')).toBe(true)
    expect(rootViews?.some((view) => view.id === 'view-a-root')).toBe(true)
    expect(rootViews?.some((view) => view.id === 'view-c-root')).toBe(true)
    expect(rootViews?.some((view) => view.artifactId === 'artifact-a' && view.revisionId === 'rev-a0')).toBe(false)
    // Graph version advanced exactly once (semantic upsert of a new view)
    expect(graph?.graphVersion).toBe(2)
  })
})
