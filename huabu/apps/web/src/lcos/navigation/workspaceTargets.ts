import type { LcosSurfaceKey } from '../shell/lcosShellStore';
import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

/**
 * Resolve the already-loaded Workspace candidates for an Assembly item.
 *
 * Scope-backed items can legitimately have multiple workspaces, so this
 * function preserves every exact match and does not choose a default target.
 * A missing canvasId is also preserved for the caller to explain honestly.
 */
export function workspaceTargetsForItem(
  item: Pick<WarehouseItemV1, 'kind' | 'entityRef'>,
  workspaces: readonly Workspace[],
): readonly Workspace[] {
  if (item.kind === 'scene') {
    return workspaces.filter((workspace) => String(workspace.id) === item.entityRef.id);
  }

  if (item.kind === 'context' || item.kind === 'workflow' || item.kind === 'collection') {
    return workspaces.filter((workspace) => String(workspace.scopeId) === item.entityRef.id);
  }

  return [];
}

/**
 * Child-worksite destination is part of the item's semantic kind, not a UI
 * guess from whichever workspace happens to be listed first.
 */
export function childSurfaceForItem(
  item: Pick<WarehouseItemV1, 'kind'>,
  workspace?: Pick<Workspace, 'preferredSurface'>,
): LcosSurfaceKey | undefined {
  if (item.kind === 'context' || item.kind === 'collection') return 'context';
  if (item.kind === 'workflow') return 'workflow';
  if (item.kind === 'scene') {
    const preferred = workspace?.preferredSurface;
    return preferred === 'main' || preferred === 'context' || preferred === 'workflow'
      ? preferred
      : undefined;
  }
  return undefined;
}
