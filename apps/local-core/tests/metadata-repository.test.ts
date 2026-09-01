import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Checkpoint, Note, PersistedContextManifestV0, ProjectGraphSnapshot, RunInputRequestV1 } from '@local-creative-os/contracts'
import type { ArtifactViewId, ContextManifestId, ProjectId, Run, RunEvent, RuntimeDispatch, WorkspaceId } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { MetadataForeignKeyConstraintError, SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []
const SCHEMA_VERSION = 50

function disposableSnapshot(): ProjectGraphSnapshot {
  const now = '2026-07-24T12:00:00.000Z'
  const projectId = 'disposable-portasplit' as ProjectGraphSnapshot['project']['id']
  const workspaceId = 'workspace-main' as ProjectGraphSnapshot['workspaces'][number]['id']
  const scopeId = 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id']
  const firstArtifactId = 'artifact-brief' as ProjectGraphSnapshot['artifacts'][number]['id']
  const secondArtifactId = 'artifact-board' as ProjectGraphSnapshot['artifacts'][number]['id']
  const firstViewId = 'view-brief' as ProjectGraphSnapshot['artifactViews'][number]['id']
  const secondViewId = 'view-board' as ProjectGraphSnapshot['artifactViews'][number]['id']
  const revisionId = 'rev-1' as ProjectGraphSnapshot['artifactRevisions'][number]['id']
  const fileRecordId = 'file-brief' as ProjectGraphSnapshot['fileRecords'][number]['id']
  const noteId = 'note-1' as ProjectGraphSnapshot['notes'][number]['id']
  const checkpointId = 'checkpoint-1' as ProjectGraphSnapshot['checkpoints'][number]['id']
  return {
    schemaVersion: SCHEMA_VERSION,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: {
      id: projectId, name: 'PortaSplit', rootPath: 'disposable://portasplit',
      graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'],
      createdAt: now, updatedAt: now,
    },
    scopes: [{
      id: scopeId, projectId, parentScopeId: null, containerViewId: null,
      kind: 'root', name: 'Root', createdAt: now, updatedAt: now,
    }],
    workspaces: [{
      id: workspaceId, projectId, scopeId, name: 'Main', intent: 'build',
      viewport: { x: 12, y: 34, zoom: 0.9 }, focusedViewIds: [], visibleLayers: ['core'], updatedAt: now,
      contextPolicy: 'selection-only',
    }],
    artifacts: [
      { id: firstArtifactId, projectId, title: 'Brief', kind: 'markdown', availability: 'available', currentRevisionId: revisionId, createdAt: now, updatedAt: now },
      { id: secondArtifactId, projectId, title: 'Board', kind: 'image', availability: 'available', createdAt: now, updatedAt: now },
    ],
    artifactViews: [
      { id: firstViewId, artifactId: firstArtifactId, scopeId, referenceKind: 'primary', position: { x: 10, y: 20 }, size: { width: 200, height: 140 }, displayMode: 'card', collapsed: false },
      { id: secondViewId, artifactId: secondArtifactId, scopeId, referenceKind: 'primary', position: { x: 310, y: 20 }, size: { width: 240, height: 160 }, displayMode: 'thumbnail', collapsed: false },
    ],
    relations: [{
      id: 'relation-1' as ProjectGraphSnapshot['relations'][number]['id'],
      projectId, sourceEntityType: 'artifact', sourceEntityId: firstArtifactId,
      targetEntityType: 'artifact', targetEntityId: secondArtifactId,
      kind: 'informs', createdAt: now, updatedAt: now,
    }],
    notes: [{
      id: noteId, projectId,
      anchor: { type: 'artifact', artifactId: firstArtifactId } as Note['anchor'],
      body: 'This brief needs more context.', createdAt: now, updatedAt: now,
    }],
    artifactRevisions: [{
      id: revisionId, artifactId: firstArtifactId,
      fileRecordId, contentHash: 'abc123def' as ProjectGraphSnapshot['artifactRevisions'][number]['contentHash'],
      source: 'import', status: 'current', createdAt: now,
    }],
    fileRecords: [{
      id: fileRecordId,
      projectId,
      observedPath: 'disposable://brief',
      observedHash: 'abc123def' as ProjectGraphSnapshot['fileRecords'][number]['observedHash'],
      size: 0,
      modifiedAt: now,
      mimeType: 'text/markdown',
      availability: 'current',
      observedAt: now,
    }],
    checkpoints: [{
      id: checkpointId, projectId, scopeId, label: 'Initial',
      snapshotJson: { nodes: [] }, createdAt: now,
    } as Checkpoint],
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(async () => {
  await delay(200)
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('SqliteMetadataRepository', () => {
  it('enforces the shared B3R5 containment guard for snapshot and Agent mutation writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-containment-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const base = disposableSnapshot()
    repository.save(base)
    const now = '2026-08-14T00:00:00.000Z'
    const makeScope = (id: string, parentScopeId: string) => ({
      id, projectId: base.project.id, parentScopeId, containerViewId: null, kind: 'collection' as const, name: id, createdAt: now, updatedAt: now,
    }) as ProjectGraphSnapshot['scopes'][number]
    const a = makeScope('scope-a', String(base.scopes[0]!.id))
    const b = makeScope('scope-b', String(a.id))
    const c = makeScope('scope-c', String(b.id))
    expect(() => repository.save({ ...base, scopes: [...base.scopes, a, b, c] })).toThrow('STRUCTURAL_DEPTH_EXCEEDED')
    expect(() => repository.applyMutations({
      baseVersion: repository.get(String(base.project.id))!.graphVersion,
      actorKind: 'agent',
      ops: [{ type: 'upsert_scope', scope: a }, { type: 'upsert_scope', scope: b }],
    }, String(base.project.id))).toThrow('AI_CONTAINER_DEPTH_EXCEEDED')
  })

  it('deletes a project and all dependent rows despite RESTRICT fks (project home delete)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-project-delete-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    repository.createCheckpoint({
      id: 'checkpoint-del-1' as Checkpoint['id'],
      projectId,
      scopeId: 'scope-root' as never,
      label: 'state',
      snapshotJson: { name: 's' } as never,
      createdAt: '2026-08-07T12:00:00.000Z',
    })

    repository.deleteProject(projectId)

    expect(repository.getProject(projectId)).toBeUndefined()
    expect(repository.get(projectId)).toBeUndefined()
    expect(repository.getArtifacts(projectId)).toHaveLength(0)
    expect(repository.getCheckpoint('checkpoint-del-1')).toBeUndefined()
    expect(repository.getNotes(projectId)).toHaveLength(0)
  })

  it('deletes a project that has real runs pointing at revisions (FK order regression)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-project-delete-runs-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    const canonicalJson = JSON.stringify({ schemaVersion: 0, project: { id: projectId }, lockedElements: [] })
    repository.createContextManifest({
      id: 'manifest-del-fk' as PersistedContextManifestV0['id'],
      projectId,
      schemaVersion: 0,
      canonicalJson,
      manifestHash: createHash('sha256').update(canonicalJson).digest('hex'),
      createdAt: '2026-08-03T08:00:00.000Z',
    })
    const run: Run = {
      id: 'run-del-fk' as Run['id'],
      projectId,
      targetArtifactId: 'artifact-brief' as Run['targetArtifactId'],
      targetRevisionId: 'rev-1' as Run['targetRevisionId'],
      contextManifestId: 'manifest-del-fk' as ContextManifestId,
      provider: 'workbuddy',
      outputIntent: 'analyze',
      returnGroupId: 'return-group-del-fk',
      status: 'created',
      instruction: 'Analyze.',
      createdAt: '2026-08-03T08:00:00.000Z',
      updatedAt: '2026-08-03T08:00:00.000Z',
    }
    repository.createRunWithDispatch(run, {
      id: 'dispatch-del-fk' as RuntimeDispatch['id'],
      runId: run.id,
      provider: 'workbuddy',
      idempotencyKey: String(run.id),
      status: 'planned',
      attemptCount: 0,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })
    // resource_descriptors.source_revision_id 是 NO ACTION 外键，必须随项目一起清理
    repository.createResourceDescriptorPending({
      schemaVersion: '0',
      id: 'resource-del-fk',
      projectId,
      resourceId: 'resource-del-fk',
      artifactId: 'artifact-brief',
      sourceRevisionId: 'rev-1',
      source: { kind: 'url', normalizedUrl: 'https://example.com', domain: 'example.com', title: 'Del' },
      display: { title: 'Del', subtitle: '' },
      detectedKinds: [],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: { status: 'pending', warnings: [], analyzerVersion: 'test' },
      createdAt: '2026-08-03T08:00:00.000Z',
      updatedAt: '2026-08-03T08:00:00.000Z',
    } as never)

    repository.deleteProject(projectId)

    expect(repository.getProject(projectId)).toBeUndefined()
    expect(repository.getRun(run.id)).toBeUndefined()
  })

  it('persists provider-neutral handoff records with resume modes (B6)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-handoffs-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId

    const created = repository.createHandoff({
      id: 'handoff-1',
      projectId,
      title: 'GPT -> Codex',
      resumeMode: 'standard-handoff',
      fromProvider: 'gpt',
      toProvider: 'codex',
      sessionSummaryId: 'summary-1',
      contextSnapshotId: 'snap-1',
      decisions: ['Keep the current canvas layout'],
      openQuestions: ['Should B-roll be added?'],
      nextActions: ['Run the golden path'],
      artifactRefs: [{ artifactId: 'artifact-brief' as never, revisionId: 'rev-1' as never }],
      messageRefs: ['msg-1', 'msg-2'],
      createdAt: '2026-08-07T11:00:00.000Z',
      updatedAt: '2026-08-07T11:00:00.000Z',
    })
    expect(created.id).toBe('handoff-1')

    const listed = repository.listHandoffs(projectId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.resumeMode).toBe('standard-handoff')
    expect(listed[0]?.decisions).toEqual(['Keep the current canvas layout'])
    expect(listed[0]?.artifactRefs[0]?.artifactId).toBe('artifact-brief')

    const got = repository.getHandoff('handoff-1')
    expect(got?.toProvider).toBe('codex')
    expect(got?.contextSnapshotId).toBe('snap-1')

    expect(repository.deleteHandoff('handoff-1')).toBe(true)
    expect(repository.listHandoffs(projectId)).toHaveLength(0)
  })

  it('persists aggregate relations with view/workspace endpoints (B2)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-relation-endpoints-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    const workspaceId = 'workspace-main' as WorkspaceId
    const viewId = 'view-brief' as ArtifactViewId
    const noteId = 'note-1' as Checkpoint['id']

    repository.upsertRelation({
      id: 'relation-workspace-feedback' as Relation['id'],
      projectId,
      sourceEntityType: 'note',
      sourceEntityId: noteId,
      targetEntityType: 'workspace',
      targetEntityId: workspaceId,
      kind: 'feedback',
      createdAt: '2026-08-07T08:00:00.000Z',
      updatedAt: '2026-08-07T08:00:00.000Z',
    })
    repository.upsertRelation({
      id: 'relation-view-delivery' as Relation['id'],
      projectId,
      sourceEntityType: 'view',
      sourceEntityId: viewId,
      targetEntityType: 'workspace',
      targetEntityId: workspaceId,
      kind: 'deliverable',
      createdAt: '2026-08-07T08:00:00.000Z',
      updatedAt: '2026-08-07T08:00:00.000Z',
    })

    const relations = repository.getRelations(projectId)
    const workspaceTargets = relations.filter((relation) => relation.targetEntityType === 'workspace')
    expect(workspaceTargets).toHaveLength(2)
    expect(workspaceTargets.map((relation) => relation.kind)).toEqual(expect.arrayContaining(['feedback', 'deliverable']))
    const viewSource = relations.find((relation) => relation.sourceEntityType === 'view')
    expect(viewSource?.sourceEntityId).toBe(viewId)
  })

  it('updates a Scope container View link instead of losing the aggregate Project-node identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-scope-container-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = disposableSnapshot()
    const projectId = snapshot.project.id
    const rootScopeId = snapshot.scopes[0]!.id
    const now = '2026-08-13T09:00:00.000Z'
    snapshot.artifacts.push({
      id: 'artifact-context-container' as ProjectGraphSnapshot['artifacts'][number]['id'],
      projectId, title: 'Context 1', kind: 'other', availability: 'available', createdAt: now, updatedAt: now,
    })
    snapshot.artifactViews.push({
      id: 'view-context-container' as ProjectGraphSnapshot['artifactViews'][number]['id'],
      artifactId: 'artifact-context-container' as ProjectGraphSnapshot['artifacts'][number]['id'],
      scopeId: rootScopeId, referenceKind: 'primary', position: { x: 10, y: 10 }, size: { width: 220, height: 130 }, displayMode: 'card', collapsed: false,
    })
    snapshot.scopes.push({
      id: 'scope-context-1' as ProjectGraphSnapshot['scopes'][number]['id'], projectId, parentScopeId: rootScopeId, containerViewId: null,
      kind: 'context', name: 'Context 1', createdAt: now, updatedAt: now,
    })
    repository.save(snapshot)

    const baseVersion = repository.get(String(projectId))?.graphVersion ?? snapshot.graphVersion
    repository.applyMutations({
      baseVersion,
      ops: [{
        type: 'upsert_scope',
        scope: {
          id: 'scope-context-1' as ProjectGraphSnapshot['scopes'][number]['id'], projectId, parentScopeId: rootScopeId,
          containerViewId: 'view-context-container' as ProjectGraphSnapshot['artifactViews'][number]['id'], kind: 'context', name: 'Context 1',
          createdAt: now, updatedAt: now,
        },
      }],
    }, String(projectId))

    expect(repository.get(String(projectId))?.scopes.find((scope) => String(scope.id) === 'scope-context-1')?.containerViewId).toBe('view-context-container')
  })

  it('persists workspace frame bounds with CAS version and no semantic graph bump (B1)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-workspace-frame-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    const workspaceId = 'workspace-main' as WorkspaceId
    const baseVersion = repository.get(projectId)?.graphVersion ?? 1

    repository.applyMutations({
      baseVersion,
      ops: [{
        type: 'update_workspace_frame',
        workspaceId,
        frameBounds: { x: 120, y: 80, width: 640, height: 420 },
        preferredSurface: 'context-flow',
        expectedVersion: 0,
      }],
    }, projectId)

    let graph = repository.get(projectId)
    let workspace = graph?.workspaces.find((item) => item.id === workspaceId)
    expect(workspace?.frameBounds).toEqual({ x: 120, y: 80, width: 640, height: 420 })
    expect(workspace?.preferredSurface).toBe('context-flow')
    expect(workspace?.version).toBe(1)
    expect(graph?.graphVersion).toBe(baseVersion)

    expect(() => repository.applyMutations({
      baseVersion,
      ops: [{ type: 'update_workspace_frame', workspaceId, frameBounds: { x: 1, y: 2, width: 3, height: 4 }, expectedVersion: 7 }],
    }, projectId)).toThrow(/version conflict/)

    repository.applyMutations({
      baseVersion,
      ops: [{ type: 'update_workspace_frame', workspaceId, frameBounds: { x: 200, y: 100, width: 500, height: 300 }, expectedVersion: 1 }],
    }, projectId)

    graph = repository.get(projectId)
    workspace = graph?.workspaces.find((item) => item.id === workspaceId)
    expect(workspace?.frameBounds).toEqual({ x: 200, y: 100, width: 500, height: 300 })
    expect(workspace?.version).toBe(2)

    const reopened = new SqliteMetadataRepository(path)
    const restored = reopened.get(projectId)?.workspaces.find((item) => item.id === workspaceId)
    expect(restored?.frameBounds).toEqual({ x: 200, y: 100, width: 500, height: 300 })
    expect(restored?.version).toBe(2)
  })

  it('persists workspace order through reorder_workspaces and across reopen (Phase 1 rail order)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-workspace-reorder-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    const secondId = 'workspace-second' as WorkspaceId
    const now = '2026-08-12T00:00:00.000Z'

    repository.applyMutations({
      baseVersion: 1,
      ops: [{
        type: 'upsert_workspace',
        workspace: {
          id: secondId, projectId, scopeId: 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id'],
          name: 'Second', intent: null,
          viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'],
          contextPolicy: 'selection-only', updatedAt: now,
        },
      }],
    }, projectId)

    let order = repository.get(projectId)?.workspaces.map((workspace) => workspace.id) ?? []
    expect(order).toEqual(['workspace-main', 'workspace-second'])

    repository.applyMutations({
      baseVersion: 2,
      ops: [{ type: 'reorder_workspaces', workspaceIds: ['workspace-second', 'workspace-main'] }],
    }, projectId)
    order = repository.get(projectId)?.workspaces.map((workspace) => workspace.id) ?? []
    expect(order).toEqual(['workspace-second', 'workspace-main'])

    expect(() => repository.applyMutations({
      baseVersion: 3,
      ops: [{ type: 'reorder_workspaces', workspaceIds: ['workspace-second'] }],
    }, projectId)).toThrow(/must cover every workspace/)

    const reopened = new SqliteMetadataRepository(path)
    order = reopened.get(projectId)?.workspaces.map((workspace) => workspace.id) ?? []
    expect(order).toEqual(['workspace-second', 'workspace-main'])
  })

  it('deletes a workspace and its memberships via delete_workspace (Phase 1 rail cleanup)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-workspace-delete-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    repository.save(disposableSnapshot())
    const projectId = 'disposable-portasplit' as ProjectId
    const secondId = 'workspace-second' as WorkspaceId
    const now = '2026-08-12T00:00:00.000Z'

    repository.applyMutations({
      baseVersion: 1,
      ops: [{
        type: 'upsert_workspace',
        workspace: {
          id: secondId, projectId, scopeId: 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id'],
          name: 'Second', intent: null,
          viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: ['view-brief'], visibleLayers: ['core'],
          contextPolicy: 'selection-only', updatedAt: now,
        },
      }],
    }, projectId)
    repository.addWorkspaceMembers(secondId, ['view-brief' as ArtifactViewId], 'user', now)

    repository.applyMutations({
      baseVersion: 2,
      ops: [{ type: 'delete_workspace', workspaceId: secondId }],
    }, projectId)

    const graph = repository.get(projectId)
    expect(graph?.workspaces.some((workspace) => workspace.id === secondId)).toBe(false)
    expect(repository.listWorkspaceMembers(secondId)).toHaveLength(0)

    const reopened = new SqliteMetadataRepository(path)
    expect(reopened.get(projectId)?.workspaces.some((workspace) => workspace.id === secondId)).toBe(false)
  })

  it('resolves artifact source path from the current file record and relinks it (Phase 2 source actions)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-source-relink-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    repository.save(disposableSnapshot())
    const artifactId = 'artifact-brief'

    const source = repository.getArtifactSourcePath(artifactId)
    expect(source?.path).toBe('disposable://brief')
    expect(source?.isUrl).toBe(false)
    expect(source?.exists).toBe(false)

    expect(repository.relinkArtifactSource(artifactId, 'C:\\real\\brief.md')).toBe(true)
    const reopened = new SqliteMetadataRepository(path)
    expect(reopened.getArtifactSourcePath(artifactId)?.path).toBe('C:\\real\\brief.md')
    expect(reopened.getFileRecord('file-brief')?.observedPath).toBe('C:\\real\\brief.md')
    expect(reopened.getArtifact(artifactId)?.availability).toBe('available')
  })

  it('persists durable run events with per-run sequence and idempotent replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-run-events-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    repository.save(disposableSnapshot())
    const canonicalJson = JSON.stringify({
      schemaVersion: 0,
      project: { id: 'disposable-portasplit' },
      lockedElements: [],
    })
    const manifestHash = createHash('sha256').update(canonicalJson).digest('hex')
    repository.createContextManifest({
      id: 'manifest-events-one' as PersistedContextManifestV0['id'],
      projectId: 'disposable-portasplit' as ProjectId,
      schemaVersion: 0,
      canonicalJson,
      manifestHash,
      createdAt: '2026-08-03T08:00:00.000Z',
    })
    const run: Run = {
      id: 'run-events-one' as Run['id'],
      projectId: 'disposable-portasplit' as ProjectId,
      contextManifestId: 'manifest-events-one' as ContextManifestId,
      provider: 'workbuddy',
      requestedProvider: 'workbuddy',
      outputIntent: 'analyze',
      returnGroupId: 'return-group-events-one',
      status: 'created',
      instruction: 'Analyze.',
      createdAt: '2026-08-03T08:00:00.000Z',
      updatedAt: '2026-08-03T08:00:00.000Z',
    }
    repository.createRunWithDispatch(run, {
      id: 'dispatch-events-one' as RuntimeDispatch['id'],
      runId: run.id,
      provider: 'workbuddy',
      idempotencyKey: String(run.id),
      status: 'planned',
      attemptCount: 0,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })

    const first = repository.createRunEvent({
      id: 'event-events-one-a' as RunEvent['id'],
      runId: run.id,
      type: 'run.queued',
      payload: { outputIntent: 'analyze' },
      occurredAt: '2026-08-03T08:00:01.000Z',
    })
    const second = repository.createRunEvent({
      id: 'event-events-one-b' as RunEvent['id'],
      runId: run.id,
      type: 'run.started',
      payload: {},
      occurredAt: '2026-08-03T08:00:02.000Z',
    })
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)

    const replay = repository.createRunEvent({
      id: 'event-events-one-a' as RunEvent['id'],
      runId: run.id,
      type: 'run.queued',
      payload: { outputIntent: 'analyze' },
      occurredAt: '2026-08-03T08:00:01.000Z',
    })
    expect(replay.sequence).toBe(1)
    expect(repository.getRunEvents(run.id)).toHaveLength(2)
    expect(repository.getRunEvents(run.id, 1).map((event) => event.type)).toEqual(['run.started'])

    repository.close()
    const reopened = new SqliteMetadataRepository(path)
    expect(reopened.getRunEvents(run.id)).toHaveLength(2)
  })

  it('keeps an answered input request closed when a delayed waiting_input result is replayed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-run-input-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    repository.save(disposableSnapshot())
    const canonicalJson = JSON.stringify({ schemaVersion: 0, project: { id: 'disposable-portasplit' }, lockedElements: [] })
    const manifestHash = createHash('sha256').update(canonicalJson).digest('hex')
    repository.createContextManifest({
      id: 'manifest-input-one' as PersistedContextManifestV0['id'],
      projectId: 'disposable-portasplit' as ProjectId,
      schemaVersion: 0,
      canonicalJson,
      manifestHash,
      createdAt: '2026-08-05T01:00:00.000Z',
    })
    const run: Run = {
      id: 'run-input-one' as Run['id'],
      projectId: 'disposable-portasplit' as ProjectId,
      contextManifestId: 'manifest-input-one' as ContextManifestId,
      provider: 'codex',
      requestedProvider: 'codex',
      outputIntent: 'analyze',
      returnGroupId: 'return-group-input-one',
      status: 'waiting_input',
      instruction: 'Analyze and ask once if needed.',
      createdAt: '2026-08-05T01:00:00.000Z',
      updatedAt: '2026-08-05T01:00:00.000Z',
    }
    repository.createRunWithDispatch(run, {
      id: 'dispatch-input-one' as RuntimeDispatch['id'],
      runId: run.id,
      provider: 'codex',
      idempotencyKey: String(run.id),
      status: 'bound',
      attemptCount: 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })
    const request: RunInputRequestV1 = {
      schemaVersion: 1,
      requestId: 'input-one',
      runId: String(run.id),
      question: '保留 A 还是 B？',
      options: ['A', 'B'],
      allowFreeText: true,
      status: 'pending',
      selectedOptions: [],
      createdAt: '2026-08-05T01:00:01.000Z',
    }
    repository.saveRunInputRequest(request)
    repository.answerRunInputRequest(run.id, { requestId: request.requestId, text: 'A', selectedOptions: ['A'] }, '2026-08-05T01:00:02.000Z')
    repository.saveRunInputRequest(request)
    expect(repository.getRunInputRequest(request.requestId)).toMatchObject({ status: 'answered', answerText: 'A', selectedOptions: ['A'] })
    expect(() => repository.saveRunInputRequest({ ...request, question: '不同的问题' })).toThrow('INPUT_REQUEST_IDEMPOTENCY_CONFLICT')
    repository.close()
  })

  it('persists canonical workspace memberships with add/remove/move and view cascade', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-memberships-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    const snapshot = disposableSnapshot()
    const extraWorkspace: ProjectGraphSnapshot['workspaces'][number] = {
      id: 'workspace-extra' as ProjectGraphSnapshot['workspaces'][number]['id'],
      projectId: snapshot.project.id,
      scopeId: 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id'],
      name: '包装方向',
      intent: 'build',
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedViewIds: [],
      visibleLayers: ['core'],
      contextPolicy: 'selection-only',
      updatedAt: '2026-08-03T09:00:00.000Z',
    }
    snapshot.workspaces = [...snapshot.workspaces, extraWorkspace]
    repository.save(snapshot)

    const workspaceId = 'workspace-main' as WorkspaceId
    const views = ['view-brief', 'view-board'] as const
    const added = repository.addWorkspaceMembers(
      workspaceId,
      views as unknown as ArtifactViewId[],
      'user',
      '2026-08-03T09:00:01.000Z',
    )
    expect(added).toHaveLength(2)
    expect(added[0]?.sortOrder).toBe(1)

    // 去重：重复加入不产生第二行
    repository.addWorkspaceMembers(workspaceId, [views[0] as unknown as ArtifactViewId], 'agent', '2026-08-03T09:00:02.000Z')
    expect(repository.listWorkspaceMembers(workspaceId)).toHaveLength(2)

    // 移动：从 main 到 extra
    const moved = repository.moveWorkspaceMembers(
      workspaceId,
      extraWorkspace.id,
      [views[0] as unknown as ArtifactViewId],
      'user',
      '2026-08-03T09:00:03.000Z',
    )
    expect(moved.map((item) => String(item.artifactViewId))).toEqual(['view-brief'])
    expect(repository.listWorkspaceMembers(workspaceId).map((item) => String(item.artifactViewId))).toEqual(['view-board'])

    // 删除 View 级联清理 Membership
    repository.deleteArtifactView('view-board')
    expect(repository.listWorkspaceMembers(workspaceId)).toHaveLength(0)
    expect(repository.listProjectWorkspaceMemberships('disposable-portasplit' as ProjectId).map((item) => String(item.artifactViewId)))
      .toEqual(['view-brief'])
  })

  it('marks link artifacts unmanaged, saves workspace states and session summaries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-v12-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const repository = new SqliteMetadataRepository(path)
    const snapshot = disposableSnapshot()
    const linkArtifact: ProjectGraphSnapshot['artifacts'][number] = {
      id: 'artifact-link' as ProjectGraphSnapshot['artifacts'][number]['id'],
      projectId: snapshot.project.id,
      title: '客户反馈.link.md',
      kind: 'markdown',
      availability: 'available',
      createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:00.000Z',
    }
    snapshot.artifacts = [...snapshot.artifacts, linkArtifact]
    repository.save(snapshot)

    expect(repository.getArtifact(String(linkArtifact.id))?.managed).toBe(false)
    const normal = repository.getArtifacts('disposable-portasplit' as ProjectId).find((item) => item.title !== '客户反馈.link.md')
    expect(normal?.managed).not.toBe(false)

    const workspaceId = 'workspace-main' as WorkspaceId
    repository.addWorkspaceMembers(workspaceId, ['view-brief' as ArtifactViewId], 'user', '2026-08-03T10:00:01.000Z')
    const state = repository.createCheckpoint({
      id: 'state-one' as Checkpoint['id'],
      projectId: 'disposable-portasplit' as ProjectId,
      scopeId: 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id'],
      workspaceId,
      label: '现场A',
      snapshotJson: { members: ['view-brief'] },
      createdAt: '2026-08-03T10:00:02.000Z',
    })
    expect(state).toBeUndefined()
    expect(repository.listWorkspaceStates(workspaceId).map((item) => item.id)).toContain('state-one')

    repository.createSessionSummary({
      id: 'session-one',
      projectId: 'disposable-portasplit' as ProjectId,
      title: '本周',
      summary: '完成方向整理',
      runIds: [],
      handoffRef: 'docs/handoffs/x.md',
      createdAt: '2026-08-03T10:00:03.000Z',
      updatedAt: '2026-08-03T10:00:03.000Z',
    })
    expect(repository.listSessionSummaries('disposable-portasplit' as ProjectId).map((item) => item.id)).toContain('session-one')
  })

  it('migrates from empty, saves metadata, and restores after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const first = new SqliteMetadataRepository(path)
    expect(first.schemaVersion).toBe(SCHEMA_VERSION)
    first.save(disposableSnapshot())
    first.close()
    await delay(100)

    const reopened = new SqliteMetadataRepository(path)
    const restored = reopened.get('disposable-portasplit')
    reopened.close()
    expect(restored).toBeDefined()
    expect(restored!.project.name).toBe('PortaSplit')
    expect(restored!.workspaces).toHaveLength(1)
    expect(restored!.artifacts).toHaveLength(2)
    expect(restored!.artifactViews).toHaveLength(2)
    expect(restored!.relations).toHaveLength(1)
    expect(restored!.notes).toHaveLength(1)
    expect(restored!.notes[0].body).toBe('This brief needs more context.')
    expect(restored!.artifactRevisions).toHaveLength(1)
    expect(restored!.artifactRevisions[0].status).toBe('current')
    expect(restored!.checkpoints).toHaveLength(1)
  })

  it('backs up a malformed v1 database before migration fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')

    // Corrupt legacy metadata must fail loudly without losing the original bytes.
    const { DatabaseSync } = await import('node:sqlite')
    const db1 = new DatabaseSync(path)
    db1.exec('PRAGMA foreign_keys = ON;')
    db1.exec(`
      BEGIN;
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE scopes (id TEXT PRIMARY KEY);
      PRAGMA user_version = 1;
      COMMIT;
    `)
    db1.close()
    await delay(100)

    expect(() => new SqliteMetadataRepository(path)).toThrow()
    const { stat } = await import('node:fs/promises')
    await expect(stat(`${path}.bak`)).resolves.toMatchObject({ size: expect.any(Number) })
  })

  it('migrates v3 revisions to v4 FileRecords and preserves a backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase3-v3-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')
    const { DatabaseSync } = await import('node:sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        graph_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL, kind TEXT NOT NULL, local_path TEXT NOT NULL,
        availability TEXT NOT NULL, current_revision_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_revisions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
        parent_revision_id TEXT, local_path TEXT NOT NULL, content_hash TEXT NOT NULL,
        source TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_scope_id TEXT, container_view_id TEXT,
        kind TEXT NOT NULL, name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
        viewport TEXT NOT NULL, focused_node_ids TEXT NOT NULL DEFAULT '[]',
        visible_layers TEXT NOT NULL DEFAULT '["core","process"]',
        context_policy TEXT NOT NULL DEFAULT 'selection-only',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE artifact_views (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
        scope_id TEXT NOT NULL, revision_id TEXT,
        reference_kind TEXT NOT NULL, position TEXT NOT NULL, size TEXT NOT NULL,
        display_mode TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE relations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_entity_type TEXT NOT NULL, source_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL, target_entity_id TEXT NOT NULL,
        kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        anchor_scope TEXT NOT NULL, artifact_id TEXT, artifact_view_id TEXT, page_index INTEGER,
        body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO projects VALUES (
        'disposable-v3', 'Legacy', 'disposable://v3', 1,
        '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z'
      );
      INSERT INTO artifacts VALUES (
        'artifact-v3', 'disposable-v3', 'Legacy source', 'markdown',
        'disposable://legacy.md', 'available', 'revision-v3',
        '2026-07-24T00:00:00.000Z', '2026-07-24T00:00:00.000Z'
      );
      INSERT INTO artifact_revisions VALUES (
        'revision-v3', 'artifact-v3', NULL, 'disposable://legacy.md', 'legacy-hash',
        'import', NULL, 'current', '2026-07-24T00:00:00.000Z'
      );
      PRAGMA user_version = 3;
    `)
    legacy.close()

    const migrated = new SqliteMetadataRepository(path)
    const revision = migrated.getArtifactRevision('revision-v3')
    const record = migrated.getFileRecord('migrated-revision-v3')
    migrated.close()
    const { stat } = await import('node:fs/promises')

    expect(revision).toMatchObject({
      id: 'revision-v3',
      fileRecordId: 'migrated-revision-v3',
      contentHash: 'legacy-hash',
      status: 'current',
    })
    expect(record).toMatchObject({
      id: 'migrated-revision-v3',
      projectId: 'disposable-v3',
      observedPath: 'disposable://legacy.md',
      observedHash: 'legacy-hash',
      availability: 'unreadable',
    })
    await expect(stat(`${path}.v3.bak`)).resolves.toMatchObject({ size: expect.any(Number) })
  })

  it('deletes a view without deleting its artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'), { disposableOnly: true })
    repository.save(disposableSnapshot())
    repository.deleteArtifactView('view-brief')
    const restored = repository.get('disposable-portasplit')
    expect(restored?.artifactViews).toHaveLength(1)
    expect(restored?.artifacts).toHaveLength(2)
    expect(restored?.relations).toHaveLength(1) // relations target entities, not views
    repository.close()
  })

  it('rejects non-disposable projects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'), { disposableOnly: true })
    const value = disposableSnapshot()
    expect(() => repository.save({
      ...value,
      project: { ...value.project, id: 'real-project' as typeof value.project.id },
    })).toThrow('Only disposable')
    repository.close()
  })

  it('reports the missing Project FK before a runtime mutation inserts an Artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase3-fk-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))

    const write = () => repository.applyMutations({
      baseVersion: 1 as ProjectGraphSnapshot['graphVersion'],
      ops: [{
        type: 'upsert_artifact',
        artifact: {
          id: 'artifact-orphan' as ProjectGraphSnapshot['artifacts'][number]['id'],
          projectId: 'project-portasplit' as ProjectGraphSnapshot['project']['id'],
          title: 'Orphan',
          kind: 'markdown',
          availability: 'available',
          createdAt: '2026-07-24T12:00:00.000Z',
          updatedAt: '2026-07-24T12:00:00.000Z',
        },
      }],
    })

    expect(write).toThrow(MetadataForeignKeyConstraintError)
    try { write() } catch (error) {
      expect(error).toBeInstanceOf(MetadataForeignKeyConstraintError)
      const context = (error as MetadataForeignKeyConstraintError).context
      expect(context).toMatchObject({
        operationType: 'upsert_artifact',
        entityId: 'artifact-orphan',
        table: 'artifacts',
        statement: 'INSERT INTO artifacts',
        foreignKeyColumn: 'project_id',
        referencedTable: 'projects',
        referencedId: 'project-portasplit',
        foreignKeyCheck: [],
      })
    }
    repository.close()
  })

  it('reports the Phase 3 v4 missing FileRecord FK before saving an ArtifactRevision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase3-fk-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snap = disposableSnapshot()
    const broken = {
      ...snap,
      fileRecords: [],
      artifactRevisions: [{
        ...snap.artifactRevisions[0],
        fileRecordId: 'file-missing' as ProjectGraphSnapshot['artifactRevisions'][number]['fileRecordId'],
      }],
    }

    const write = () => repository.save(broken)

    expect(write).toThrow(MetadataForeignKeyConstraintError)
    try { write() } catch (error) {
      expect(error).toBeInstanceOf(MetadataForeignKeyConstraintError)
      const context = (error as MetadataForeignKeyConstraintError).context
      expect(context).toMatchObject({
        operationType: 'save_artifact_revision',
        entityId: 'rev-1',
        table: 'artifact_revisions',
        statement: 'INSERT INTO artifact_revisions',
        foreignKeyColumn: 'file_record_id',
        referencedTable: 'file_records',
        referencedId: 'file-missing',
        foreignKeyCheck: [],
      })
    }
    repository.close()
  })

  // ==================== Individual CRUD tests ====================

  it('CRUD for Notes works individually', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snap = disposableSnapshot()
    repository.save(snap)

    const now = '2026-07-24T13:00:00.000Z'
    const newNote: Note = {
      id: 'note-new' as Note['id'],
      projectId: snap.project.id,
      anchor: { type: 'page', revisionId: snap.artifactRevisions[0].id, pageIndex: 3 },
      body: 'Page 3 commentary.',
      createdAt: now,
      updatedAt: now,
    }
    repository.upsertNote(newNote)
    let notes = repository.getNotes('disposable-portasplit')
    expect(notes).toHaveLength(2)
    expect(notes.find((n) => n.id === 'note-new')?.body).toBe('Page 3 commentary.')

    repository.upsertNote({ ...newNote, body: 'Updated commentary.', updatedAt: now })
    expect(repository.getNote('note-new')?.body).toBe('Updated commentary.')

    repository.deleteNote('note-new')
    notes = repository.getNotes('disposable-portasplit')
    expect(notes).toHaveLength(1)
    repository.close()
  })

  it('CRUD for ArtifactRevisions works', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snap = disposableSnapshot()
    repository.save(snap)

    const now = '2026-07-24T14:00:00.000Z'
    const revision = {
      id: 'rev-2' as typeof snap.artifactRevisions[0]['id'],
      artifactId: snap.artifacts[0].id,
      fileRecordId: snap.fileRecords[0].id,
      contentHash: 'def456abc' as typeof snap.artifactRevisions[0]['contentHash'],
      source: 'run',
      status: 'draft',
      createdAt: now,
    } as const
    repository.save({ ...snap, artifactRevisions: [...snap.artifactRevisions, revision] })
    const revisions = repository.getArtifactRevisions('artifact-brief')
    expect(revisions).toHaveLength(2)
    expect(revisions.find((r) => r.id === 'rev-2')?.status).toBe('draft')
    repository.close()
  })

  it('Checkpoint CRUD stores snapshot_json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snap = disposableSnapshot()
    repository.save(snap)

    const now = '2026-07-24T15:00:00.000Z'
    const cp: Checkpoint = {
      id: 'cp-2' as Checkpoint['id'],
      projectId: snap.project.id,
      scopeId: snap.scopes[0].id,
      label: 'Review',
      snapshotJson: { nodes: [{ id: 'n1' }], camera: { x: 100, y: 200, zoom: 1.5 } },
      createdAt: now,
    }
    repository.createCheckpoint(cp)
    const checkpoints = repository.getCheckpoints('disposable-portasplit')
    expect(checkpoints).toHaveLength(2)
    const restored = checkpoints.find((c) => c.id === 'cp-2')
    expect(restored).toBeDefined()
    expect(restored!.snapshotJson).toEqual({ nodes: [{ id: 'n1' }], camera: { x: 100, y: 200, zoom: 1.5 } })
    repository.close()
  })

  it('restart recovery: save, close, reopen, restore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-phase2-'))
    cleanup.push(directory)
    const path = join(directory, 'metadata.sqlite')

    const session1 = new SqliteMetadataRepository(path)
    session1.save(disposableSnapshot())
    session1.close()
    await delay(100)

    const session2 = new SqliteMetadataRepository(path)
    const restored = session2.get('disposable-portasplit')
    session2.close()

    expect(restored).toBeDefined()
    expect(restored!.project.name).toBe('PortaSplit')
    expect(restored!.workspaces[0].viewport).toEqual({ x: 12, y: 34, zoom: 0.9 })
    expect(restored!.notes).toHaveLength(1)
    expect(restored!.artifactRevisions).toHaveLength(1)
    expect(restored!.checkpoints).toHaveLength(1)
  })

  it('forbids generic artifact mutation from changing Current Revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-current-guard-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = disposableSnapshot()
    repository.save(snapshot)
    const artifact = repository.getArtifact('artifact-brief')!

    expect(() => repository.upsertArtifact({
      ...artifact,
      currentRevisionId: 'rev-bypass' as typeof artifact.currentRevisionId,
      updatedAt: '2026-07-24T16:00:00.000Z',
    })).toThrow('currentRevisionId may only change through an explicit Revision lifecycle.')
    expect(repository.getArtifact('artifact-brief')?.currentRevisionId).toBe('rev-1')
    repository.close()
  })
})




