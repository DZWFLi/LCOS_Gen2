import type { RailwayCanonicalRefV1 } from '@local-creative-os/contracts';

export interface PortalWorkspaceAddress {
  readonly id: string;
  readonly name: string;
  readonly canvasId?: string;
  readonly preferredSurface?: string;
}

/** A pinned identity never falls back to a different workspace reusing its canvas. */
export function resolvePortalAddress(projectId: string | undefined, workspaces: readonly PortalWorkspaceAddress[],
  canvasId: string | undefined, pinnedWorkspaceId?: string) {
  if (!projectId || !canvasId) return undefined;
  const matches = workspaces.filter((workspace) => workspace.canvasId === canvasId);
  if (matches.length !== 1) return undefined;
  const workspace = matches[0]!;
  if (pinnedWorkspaceId !== undefined && workspace.id !== pinnedWorkspaceId) return undefined;
  const surface = workspace.preferredSurface;
  if (surface !== 'main' && surface !== 'context' && surface !== 'workflow') return undefined;
  const destinationRef: RailwayCanonicalRefV1 = {kind:'worksite',projectId,worksiteId:workspace.id};
  return {workspaceId:workspace.id,canvasId,targetSurface:surface as 'main' | 'context' | 'workflow',label:workspace.name,destinationRef,
    targetRef:{kind:'workspace' as const,id:workspace.id}};
}
