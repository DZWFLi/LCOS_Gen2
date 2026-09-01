import type { Checkpoint, CheckpointId, JsonValue, ProjectId, ScopeId, WorkspaceId } from '@local-creative-os/domain'
import type {
  BranchSnapshotResultV1 as BranchSnapshotResult,
  ContextSnapshotRefsV1 as ContextSnapshotRefs,
  SnapshotCompareResultV1 as SnapshotCompareResult,
} from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'

function diffRefs(base: ContextSnapshotRefs, other: ContextSnapshotRefs): ContextSnapshotRefs {
  return {
    schemaVersion: 1,
    savedAt: other.savedAt,
    workspaceId: other.workspaceId,
    scopeId: other.scopeId,
    focusedViewIds: other.focusedViewIds.filter((id) => !base.focusedViewIds.includes(id)),
    artifactIds: other.artifactIds.filter((id) => !base.artifactIds.includes(id)),
    relationIds: other.relationIds.filter((id) => !base.relationIds.includes(id)),
    noteIds: other.noteIds.filter((id) => !base.noteIds.includes(id)),
    runIds: other.runIds.filter((id) => !base.runIds.includes(id)),
  }
}

function intersect(base: ContextSnapshotRefs, other: ContextSnapshotRefs): ContextSnapshotRefs {
  return {
    schemaVersion: 1,
    savedAt: other.savedAt,
    workspaceId: other.workspaceId,
    scopeId: other.scopeId,
    focusedViewIds: other.focusedViewIds.filter((id) => base.focusedViewIds.includes(id)),
    artifactIds: other.artifactIds.filter((id) => base.artifactIds.includes(id)),
    relationIds: other.relationIds.filter((id) => base.relationIds.includes(id)),
    noteIds: other.noteIds.filter((id) => base.noteIds.includes(id)),
    runIds: other.runIds.filter((id) => base.runIds.includes(id)),
  }
}

/**
 * B5 — ContextSnapshot history / compare / branch.
 *
 * Backed by the existing immutable Checkpoint table; never a second truth.
 * A snapshot freezes the *refs* of a workspace context (views, artifacts,
 * relations, notes, linked runs) so users can compare context versions and
 * branch a snapshot into a collection scope without copying artifacts.
 */
export class ContextSnapshotService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly createId: () => string = () => `ctx-snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}

  list(projectId: ProjectId, workspaceId?: WorkspaceId): readonly Checkpoint[] {
    const checkpoints = this.repository.get(projectId)?.checkpoints ?? []
    return workspaceId === undefined
      ? checkpoints
      : checkpoints.filter((checkpoint) => checkpoint.workspaceId !== undefined && String(checkpoint.workspaceId) === String(workspaceId))
  }

  create(projectId: ProjectId, label: string, workspaceId?: WorkspaceId, now = new Date().toISOString()): Checkpoint {
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('PROJECT_NOT_FOUND')
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error('PROJECT_NOT_FOUND')
    const rootScope = graph.scopes.find((scope) => scope.kind === 'root') ?? graph.scopes[0]
    const workspace = workspaceId === undefined ? undefined : this.repository.getWorkspace(String(workspaceId))
    const scopeId = workspace?.scopeId ?? rootScope?.id
    const focusedViewIds = workspace === undefined ? [] : workspace.focusedViewIds.map(String)
    const memberships = workspaceId === undefined ? [] : this.repository.listWorkspaceMembers(workspaceId)
    const memberViewIds = new Set(memberships.map((membership) => String(membership.artifactViewId)))
    const viewIds = Array.from(new Set([...focusedViewIds, ...memberViewIds]))

    const artifacts = this.repository.getArtifacts(projectId)
    const views = artifacts.flatMap((artifact) => this.repository.getArtifactViews(String(artifact.id)))
    const viewIdsSet = new Set(viewIds)
    const artifactIds = Array.from(new Set(views.filter((view) => viewIdsSet.has(String(view.id))).map((view) => String(view.artifactId))))
    const relations = this.repository.getRelations(projectId)
    const relationIds = relations
      .filter((relation) => artifactIds.includes(String(relation.sourceEntityId)) || artifactIds.includes(String(relation.targetEntityId)))
      .map((relation) => String(relation.id))
    const notes = this.repository.getNotes(projectId)
    const noteIds = notes
      .filter((note) => {
        if (note.anchor.type === 'artifact_view' && viewIdsSet.has(String(note.anchor.viewId))) return true
        if (note.anchor.type === 'artifact' && artifactIds.includes(String(note.anchor.artifactId))) return true
        return false
      })
      .map((note) => String(note.id))
    const runIds = this.repository.getProjectRuns(projectId, 200)
      .filter((run) => workspaceId === undefined || (run.workspaceId !== undefined && String(run.workspaceId) === String(workspaceId)))
      .map((run) => String(run.id))

    const refs: ContextSnapshotRefs = {
      schemaVersion: 1,
      savedAt: now,
      workspaceId: workspaceId === undefined ? null : String(workspaceId),
      scopeId: scopeId === undefined ? null : String(scopeId),
      focusedViewIds: viewIds,
      artifactIds,
      relationIds,
      noteIds,
      runIds,
    }
    const checkpoint: Checkpoint = {
      id: this.createId() as CheckpointId,
      projectId,
      scopeId: (scopeId ?? '') as ScopeId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      label,
      snapshotJson: refs as unknown as JsonValue,
      createdAt: now,
    }
    this.repository.createCheckpoint(checkpoint)
    return checkpoint
  }

  get(projectId: ProjectId, snapshotId: string): Checkpoint {
    const checkpoint = this.repository.getCheckpoint(snapshotId)
    if (checkpoint === undefined || String(checkpoint.projectId) !== String(projectId)) {
      throw new Error('CONTEXT_SNAPSHOT_NOT_FOUND')
    }
    return checkpoint
  }

  compare(projectId: ProjectId, baseId: string, otherId: string): SnapshotCompareResult {
    const base = this.get(projectId, baseId).snapshotJson as unknown as ContextSnapshotRefs
    const other = this.get(projectId, otherId).snapshotJson as unknown as ContextSnapshotRefs
    return {
      base: baseId,
      other: otherId,
      added: diffRefs(base, other),
      removed: diffRefs(other, base),
      kept: intersect(base, other),
    }
  }

  branch(projectId: ProjectId, snapshotId: string, label: string, targetScopeId?: ScopeId, now = new Date().toISOString()): BranchSnapshotResult {
    const checkpoint = this.get(projectId, snapshotId)
    const refs = checkpoint.snapshotJson as unknown as ContextSnapshotRefs
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('PROJECT_NOT_FOUND')
    const scopes = this.repository.get(projectId)?.scopes ?? []
    const rootScope = scopes.find((scope) => scope.kind === 'root')
    const parentScopeId = targetScopeId ?? rootScope?.id
    if (parentScopeId === undefined) throw new Error('ROOT_SCOPE_NOT_FOUND')

    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error('PROJECT_NOT_FOUND')
    const scopeId = targetScopeId ?? `${this.createId()}-scope` as ScopeId
    if (targetScopeId === undefined) {
      this.repository.applyMutations({
        baseVersion: graph.graphVersion,
        ops: [{
          type: 'upsert_scope',
          scope: {
            id: scopeId,
            projectId,
            parentScopeId,
            containerViewId: null,
            kind: 'collection',
            name: label,
            createdAt: now,
            updatedAt: now,
          },
        }],
      }, projectId)
    }

    const artifacts = this.repository.getArtifacts(projectId)
    const views = artifacts.flatMap((artifact) => this.repository.getArtifactViews(String(artifact.id)))
    const refsArtifactIds = new Set(refs.artifactIds)
    const sourceViews = views.filter((view) => refsArtifactIds.has(String(view.artifactId)))
    const additions = sourceViews.map((view, index) => ({
      ...view,
      id: `${this.createId()}-view` as never,
      scopeId,
      position: { x: 120 + (index % 3) * 300, y: 120 + Math.floor(index / 3) * 210 },
    }))
    if (additions.length > 0) {
      const current = this.repository.get(projectId)
      this.repository.applyMutations({
        baseVersion: current?.graphVersion ?? graph.graphVersion,
        ops: additions.map((view) => ({ type: 'upsert_artifact_view' as const, view })),
      }, projectId)
    }
    return { scopeId, viewIds: additions.map((view) => String(view.id)) }
  }
}
