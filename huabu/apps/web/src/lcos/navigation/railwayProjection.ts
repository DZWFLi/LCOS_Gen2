// Railway destination projection — Core rail order to a small, honest view model.
// This is a read projection only: order truth remains in Core and activation is
// delegated to the existing Surface/Portal/Locate owners.

import type { LcosSurfaceKey } from '../shell/lcosShellStore';
import type {
  ProjectViewRailKindV0,
  ProjectViewRailRefV0,
} from '@local-creative-os/contracts';

export interface RailwayProjectionWorkspace {
  readonly id: string;
  readonly name: string;
  readonly scopeId: string;
}

export interface RailwayProjectionScope {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface RailwayDestinationProjection {
  readonly key: string;
  readonly kind: ProjectViewRailKindV0;
  readonly viewId: string;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
  /** Exact workspace target when this destination resolves unambiguously. */
  readonly workspaceId?: string;
  /** Home Surface is metadata only; it is not permission to collapse a destination into a root switch. */
  readonly surface?: LcosSurfaceKey;
}

export interface RailwayProjectionInput {
  readonly orderedRefs: readonly ProjectViewRailRefV0[];
  readonly workspaces: readonly RailwayProjectionWorkspace[];
  readonly scopes: readonly RailwayProjectionScope[];
  readonly surfaceByWorkspace: ReadonlyMap<string, LcosSurfaceKey>;
}

function unavailable(
  ref: ProjectViewRailRefV0,
  label: string,
  reason: string,
): RailwayDestinationProjection {
  return {
    key: `${ref.kind}:${ref.viewId}`,
    kind: ref.kind,
    viewId: ref.viewId,
    label,
    available: false,
    reason,
  };
}

function available(
  ref: ProjectViewRailRefV0,
  label: string,
  workspaceId: string,
  surface: LcosSurfaceKey,
): RailwayDestinationProjection {
  return {
    key: `${ref.kind}:${ref.viewId}`,
    kind: ref.kind,
    viewId: ref.viewId,
    label,
    available: true,
    workspaceId,
    surface,
  };
}

function workspaceForScope(
  scopeId: string,
  workspaces: readonly RailwayProjectionWorkspace[],
  surfaceByWorkspace: ReadonlyMap<string, LcosSurfaceKey>,
): RailwayProjectionWorkspace | undefined {
  const candidates = workspaces.filter(
    (workspace) =>
      workspace.scopeId === scopeId && surfaceByWorkspace.has(workspace.id),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Project only Core ordered refs; an empty order stays empty (no static roots). */
export function projectRailwayDestinations(
  input: RailwayProjectionInput,
): readonly RailwayDestinationProjection[] {
  const workspacesById = new Map(
    input.workspaces.map((workspace) => [workspace.id, workspace]),
  );
  const scopesById = new Map(input.scopes.map((scope) => [scope.id, scope]));

  return input.orderedRefs
    .filter((ref) => {
      // Older dev data seeded Main / Context / Workflow root workspaces into
      // Railway. Those rows are a second SurfaceDock, not durable destinations.
      // Keep them in Core for rollback compatibility, but never project them.
      // Child workspaces can also be mapped to a Surface; the scope kind is the
      // only source-side distinction we have, so do not hide every mapped row.
      const rootWorkspace = workspacesById.get(ref.viewId);
      const rootScope = rootWorkspace
        ? scopesById.get(rootWorkspace.scopeId)
        : undefined;
      return !(
        rootWorkspace &&
        rootScope?.kind === 'root' &&
        input.surfaceByWorkspace.has(rootWorkspace.id)
      );
    })
    .map((ref) => {
    const workspace = workspacesById.get(ref.viewId);

    if (ref.kind === 'scene') {
      if (!workspace)
        return unavailable(ref, ref.viewId, '工作现场不存在或已归档');
      const surface = input.surfaceByWorkspace.get(workspace.id);
      if (!surface)
        return unavailable(ref, workspace.name, '工作现场尚未绑定可用 Surface');
      return available(ref, workspace.name, workspace.id, surface);
    }

    // Context/Workflow refs may point to a scope or to its one durable workspace.
    // Only an unambiguous existing Surface root is activatable; this avoids
    // silently treating a collection or arbitrary scope as a root Surface.
    if (ref.kind === 'context' || ref.kind === 'workflow') {
      const scope = scopesById.get(ref.viewId);
      const mappedWorkspace = scope
        ? workspaceForScope(
            scope.id,
            input.workspaces,
            input.surfaceByWorkspace,
          )
        : workspace;
      if (!mappedWorkspace) {
        return unavailable(
          ref,
          scope?.name ?? workspace?.name ?? ref.viewId,
          '未解析到唯一可恢复的工作现场',
        );
      }
      const surface = input.surfaceByWorkspace.get(mappedWorkspace.id);
      return surface
        ? available(
            ref,
            scope?.name ?? mappedWorkspace.name,
            mappedWorkspace.id,
            surface,
          )
        : unavailable(
            ref,
            scope?.name ?? mappedWorkspace.name,
            '工作现场尚未绑定可用 Surface',
          );
    }

    // The blueprint explicitly forbids auto-promoting a collection to a Worksite.
    const scope = scopesById.get(ref.viewId);
    return unavailable(
      ref,
      scope?.name ?? ref.viewId,
      '集合目的地暂不可达（等待既有 Portal / Receiver 能力）',
    );
    });
}
