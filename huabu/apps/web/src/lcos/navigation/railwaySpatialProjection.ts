import { railwayStableKeyV1 } from '@local-creative-os/contracts';
import type { RailwayDestinationV1, RailwaySnapshotV1 } from '@local-creative-os/contracts';
import type { LcosSurfaceKey } from '../shell/lcosShellStore';

/** G1 Project Spatial Switcher: project spaces are visible without a pinning ceremony.
 * Core still owns identities; only already materialized Workspace candidates are lifted.
 * This projection performs no writes and never promotes a temporary Scope/Collection.
 */
export function railwaySpatialProjection(
  snapshot: RailwaySnapshotV1 | undefined,
  projectId: string,
  canvases?: Readonly<Partial<Record<LcosSurfaceKey, string>>>,
): RailwayDestinationV1[] {
  const roots: RailwayDestinationV1[] = (['main', 'context', 'workflow'] as const).flatMap(surface => {
    const canvasId = canvases?.[surface];
    if (!canvasId) return [];
    const ref = {kind: 'surface_root' as const, projectId, surface};
    return [{key: railwayStableKeyV1(ref), ref, role: 'surface' as const,
      label: {main:'Main',context:'Context',workflow:'Workflow'}[surface],
      surface, canvasId, available: true, accepts: []}];
  });
  const items = [...roots, ...(snapshot?.destinations ?? []).filter(item => item.role !== 'surface'),
    ...(snapshot?.candidates ?? []).filter(item => item.role === 'worksite')];
  return [...new Map(items.map(item => [item.key, item])).values()];
}
