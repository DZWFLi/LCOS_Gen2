import type { ProjectGraphSnapshot } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

/** Selection for NEW projections, using existing canonical working-set refs.
 * Does not remove existing projections, create memberships or copy Core x/y.
 * An explicitly received view wins over scope fallback, retaining its revision. */
export function worksiteProjectionInput(graph: ProjectGraphSnapshot | undefined, workspace: Workspace | undefined) {
  const scope = graph?.scopes?.find((s) => String(s.id) === String(workspace?.scopeId));
  const root = !workspace || scope?.kind === 'root';
  const views = graph?.artifactViews ?? [];
  const memberships = graph?.workspaceMemberships;
  const focused = new Set(workspace?.focusedViewIds.map(String) ?? []);
  const explicit = new Set((memberships ?? []).filter((m) => String(m.workspaceId) === String(workspace?.id)).map((m) => String(m.artifactViewId)));
  const eligibleViews = root ? (workspace ? views.filter((v) => String(v.scopeId) === String(workspace.scopeId)) : views) : views.filter((v) => explicit.has(String(v.id)) || focused.has(String(v.id)) || String(v.scopeId) === String(workspace?.scopeId));
  // No hierarchy guess: a view explicitly present in the working set can be from another scope.
  const preferredViews = new Set([...explicit, ...focused]);
  // Older read-only graph clients omitted BOTH fields altogether. Preserve
  // their previous projection behavior; an explicit empty field in the new
  // graph is authoritative and must never fall back to every project artifact.
  const legacyGraph = graph !== undefined && !Array.isArray(graph.artifactViews) && !Array.isArray(graph.workspaceMemberships);
  const artifactIds = root || legacyGraph ? undefined : new Set(eligibleViews.map((v) => String(v.artifactId)));
  const noteIds = new Set((graph?.workspaceEntityMemberships ?? [])
    .filter((m) => String(m.workspaceId) === String(workspace?.id) && m.entityType === 'note').map((m) => String(m.entityId)));
  return {root, views: eligibleViews, preferredViews, artifactIds, notes: (graph?.notes ?? []).filter((n) => !root && noteIds.has(String(n.id)))};
}
