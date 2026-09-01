import type { Checkpoint, JsonValue, WorkspaceId } from '@local-creative-os/domain'

import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface WorkspaceStateSnapshot {
  readonly name: string
  readonly savedAt: string
  readonly workspace: {
    readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number }
    readonly focusedViewIds: readonly string[]
    readonly visibleLayers: readonly string[]
    readonly intent: string | null
  }
  readonly memberships: readonly { readonly artifactViewId: string; readonly revisionId?: string }[]
  readonly linkedRunIds: readonly string[]
}

export class WorkspaceStateService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  save(workspaceId: WorkspaceId, name: string, now: string): Checkpoint {
    const workspace = this.repository.getWorkspace(String(workspaceId))
    if (workspace === undefined) throw new Error('Workspace not found.')
    const memberships = this.repository.listWorkspaceMembers(workspaceId)
    const views = new Map(
      this.repository.getArtifacts(String(workspace.projectId))
        .flatMap((artifact) => this.repository.getArtifactViews(String(artifact.id)))
        .map((view) => [String(view.id), view]),
    )
    const projectRuns = this.repository.getProjectRuns(workspace.projectId, 100)
    const snapshot: WorkspaceStateSnapshot = {
      name,
      savedAt: now,
      workspace: {
        viewport: workspace.viewport,
        focusedViewIds: workspace.focusedViewIds.map(String),
        visibleLayers: workspace.visibleLayers,
        intent: workspace.intent,
      },
      memberships: memberships.map((membership) => {
        const view = views.get(String(membership.artifactViewId))
        return {
          artifactViewId: String(membership.artifactViewId),
          ...(view?.revisionId === undefined ? {} : { revisionId: String(view.revisionId) }),
        }
      }),
      linkedRunIds: projectRuns
        .filter((run) => run.workspaceId !== undefined && String(run.workspaceId) === String(workspaceId))
        .map((run) => String(run.id)),
    }
    const checkpoint: Checkpoint = {
      id: `ws-state-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as Checkpoint['id'],
      projectId: workspace.projectId,
      scopeId: workspace.scopeId,
      workspaceId,
      label: name,
      snapshotJson: snapshot as unknown as JsonValue,
      createdAt: now,
    }
    this.repository.createCheckpoint(checkpoint)
    return checkpoint
  }

  list(workspaceId: WorkspaceId): readonly Checkpoint[] {
    return this.repository.listWorkspaceStates(workspaceId)
  }

  restore(stateId: string): WorkspaceStateSnapshot {
    const checkpoint = this.repository.getCheckpoint(stateId)
    if (checkpoint === undefined || checkpoint.workspaceId === undefined) {
      throw new Error('Workspace state not found.')
    }
    const snapshot = checkpoint.snapshotJson as unknown as WorkspaceStateSnapshot
    this.repository.addWorkspaceMembers(
      checkpoint.workspaceId,
      snapshot.memberships.map((membership) => membership.artifactViewId) as never,
      'user',
      new Date().toISOString(),
    )
    return snapshot
  }
}
