import { randomUUID } from 'node:crypto'

import type { ArtifactView, ProjectId, ScopeId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from './metadata-repository.js'

export interface MergeWorkbenchResult {
  readonly mergedViews: number
  readonly restoredRefs: number
  readonly removedViews: number
}

/**
 * B4 — Workbench branch/merge application service.
 *
 * A workbench is a temporary scope holding View References to canonical
 * Artifacts. Merge atomically:
 *   - keeps stable views (view points at the artifact's current revision)
 *     by creating a root-scope View Reference (never a copy of the Artifact);
 *   - reuses the existing root view when one already references the same Artifact;
 *   - removes the temporary workbench views.
 *
 * Runs, Revisions, Sessions and Snapshots are never deleted.
 */
export class WorkbenchService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly createId: () => string = randomUUID,
  ) {}

  merge(projectId: ProjectId, workbenchScopeId: ScopeId): MergeWorkbenchResult {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error('PROJECT_NOT_FOUND')
    const workbench = graph.scopes.find((scope) => scope.id === workbenchScopeId)
    if (workbench === undefined) throw new Error('WORKBENCH_SCOPE_NOT_FOUND')
    const root = graph.scopes.find((scope) => scope.kind === 'root')
    if (root === undefined) throw new Error('ROOT_SCOPE_NOT_FOUND')
    if (workbench.id === root.id) return { mergedViews: 0, restoredRefs: 0, removedViews: 0 }

    const benchViews = graph.artifactViews.filter((view) => view.scopeId === workbench.id)
    if (benchViews.length === 0) return { mergedViews: 0, restoredRefs: 0, removedViews: 0 }

    const rootViews = graph.artifactViews.filter((view) => view.scopeId === root.id)
    const artifacts = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const canonicalKey = (view: ArtifactView): string => String(view.artifactId ?? view.id)
    const existing = new Map(rootViews.map((view) => [canonicalKey(view), view]))
    const benchToRoot = new Map<string, string>()
    const additions: ArtifactView[] = []

    for (const view of benchViews) {
      const key = canonicalKey(view)
      const current = existing.get(key)
      if (current !== undefined) {
        benchToRoot.set(String(view.id), String(current.id))
        continue
      }
      const artifact = view.artifactId === undefined ? undefined : artifacts.get(String(view.artifactId))
      const stable = artifact !== undefined
        && artifact.currentRevisionId !== undefined
        && (view.revisionId ?? artifact.currentRevisionId) === artifact.currentRevisionId
      if (!stable) continue
      const id = this.createId()
      benchToRoot.set(String(view.id), id)
      additions.push({ ...view, id: id as ArtifactView['id'], scopeId: root.id })
    }

    if (additions.length > 0 || benchViews.length > 0) {
      this.repository.applyMutations({
        baseVersion: graph.graphVersion,
        ops: [
          ...additions.map((view) => ({ type: 'upsert_artifact_view' as const, view })),
          ...benchViews.map((view) => ({ type: 'delete_artifact_view' as const, viewId: view.id })),
        ],
      }, projectId)
    }

    return {
      mergedViews: additions.length,
      restoredRefs: benchToRoot.size - additions.length,
      removedViews: benchViews.length,
    }
  }
}
