import type { ProjectId } from '@local-creative-os/domain'
import type { ProcessProjectionV1Item } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * Canvas Process Projection：只投影最多 3 个真实 Run。
 * Revision、Checkpoint 和旧 Run 属于 Activity/Workbench，不进入默认 Canvas。
 */
export class ProcessProjectionService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  project(projectId: ProjectId): readonly ProcessProjectionV1Item[] {
    const runs = this.repository.getProjectRuns(projectId, 20)
    const active = runs.filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status))
    const recentTerminal = runs.filter((run) => ['completed', 'failed', 'cancelled'].includes(run.status))
    const visibleRuns = [...active, ...recentTerminal].slice(0, 3)
    const views = this.repository.getArtifactViewsByProject(String(projectId))
    const viewIdsByArtifact = new Map<string, string[]>()
    for (const view of views) {
      const artifactId = String(view.artifactId)
      viewIdsByArtifact.set(artifactId, [...(viewIdsByArtifact.get(artifactId) ?? []), String(view.id)])
    }
    const viewsForArtifacts = (artifactIds: Iterable<string>) => [...new Set([...artifactIds].flatMap((id) => viewIdsByArtifact.get(id) ?? []))]

    const projected: ProcessProjectionV1Item[] = visibleRuns.map((run) => {
      const targetArtifactIds = run.targetArtifactId === undefined ? [] : [String(run.targetArtifactId)]
      const manifest = this.repository.getContextManifest(run.contextManifestId)
      const contextArtifactIds = manifest === undefined ? [] : artifactIdsFromManifest(manifest.canonicalJson)
      const outputArtifactIds = this.repository.getArtifactReturns(run.id).map((item) => String(item.targetArtifactId))
      return {
        schemaVersion: 1,
        kind: 'run',
        id: `projection-${String(run.id)}`,
        runId: String(run.id),
        title: `Run · ${String(run.id)}`,
        summary: run.shortSummary ?? run.resultSummary ?? run.instruction.slice(0, 120),
        status: run.status,
        provider: run.provider,
        contextViewIds: viewsForArtifacts(contextArtifactIds.filter((id) => !targetArtifactIds.includes(id))),
        targetViewIds: viewsForArtifacts(targetArtifactIds),
        outputViewIds: viewsForArtifacts(outputArtifactIds),
        createdAt: run.createdAt,
      }
    })
    return projected.reverse()
  }
}

function artifactIdsFromManifest(canonicalJson: string): string[] {
  try {
    const ids = new Set<string>()
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (typeof value !== 'object' || value === null) return
      for (const [key, child] of Object.entries(value)) {
        if (key === 'artifactId' && typeof child === 'string') ids.add(child)
        else visit(child)
      }
    }
    visit(JSON.parse(canonicalJson) as unknown)
    return [...ids]
  } catch {
    return []
  }
}
