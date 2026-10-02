// Child worksite navigation — the shared Portal entry seam for Context/Assembly.
//
// This helper only captures transient return context and routes to an already
// resolved Core workspace. It does not create a graph, canvas, or second camera.
// The destination workspace/canvas remains owned by Core/Huabu; the shell store
// only remembers enough UI context to return the user to the exact source.

import useCanvasStore from '@/store/canvasStore';

import {
  animateCurrentWorksiteCamera,
  entryStartViewport,
  worksiteCameraViewportSize,
} from './worksiteCameraTransition';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';

import type { Workspace } from '@local-creative-os/domain';

export interface BeginChildWorksiteNavigationInput {
  readonly projectId: string;
  readonly sourceSurface: LcosSurfaceKey;
  readonly sourceWorkspaceId?: string;
  readonly sourceWasChild: boolean;
  readonly targetSurface: LcosSurfaceKey;
  readonly targetWorkspace: Pick<Workspace, 'id' | 'canvasId'>;
  /** Exact source projection to approach when the caller can resolve it. */
  readonly sourceNodeId?: string;
  readonly navigate: (to: string) => void;
  readonly signal?: AbortSignal;
}

/**
 * Capture the exact source identity, then enter an existing workspace.
 *
 * Resolves true only after the existing Canvas owner confirms loading. Return
 * context commits at that point; failed or superseded attempts leave it intact.
 * Returning false means the target is not a usable child worksite yet. Callers
 * should leave the card/action visible and explain that the canvas is missing;
 * they must not guess a surface root or silently create a different target.
 */
export async function beginChildWorksiteNavigation(
  input: BeginChildWorksiteNavigationInput,
): Promise<boolean> {
  if (input.targetWorkspace.canvasId === undefined || input.signal?.aborted) return false;
  const targetCanvasId = input.targetWorkspace.canvasId;

  const canvas = useCanvasStore.getState();
  const sourceCanvasId = canvas.canvasId;
  const references = useLcosReferenceStore.getState().nodeEntityRefs;
  const selectedNodes = canvas.nodes.filter((node) => node.selected);
  const approachNodeIds = input.sourceNodeId === undefined
    ? selectedNodes.map((node) => node.id)
    : [input.sourceNodeId];
  const sourceEntityRefs = selectedNodes.flatMap((node) => {
    const ref = references.get(node.id);
    return ref?.entityType !== undefined && ref.entityId !== undefined
      ? [{ nodeId: node.id, entityType: ref.entityType, entityId: ref.entityId }]
      : [];
  });

  const sourceViewport = canvas.rfInstance?.getViewport() ?? canvas.viewport ?? undefined;
  const shell = useLcosShellStore.getState();
  const transitionId = shell.requestWorksiteCameraTransition({
    canvasId: targetCanvasId,
    kind: 'enter-settle',
  });

  try {
    const sourceApproachViewport = await animateCurrentWorksiteCamera({
      direction: 'approach',
      nodeIds: approachNodeIds,
    });
    if (input.signal?.aborted) {
      const current = useLcosShellStore.getState();
      if (current.worksiteCameraTransition?.id === transitionId) {
        current.consumeWorksiteCameraTransition(transitionId);
        if (sourceViewport && useCanvasStore.getState().canvasId === sourceCanvasId) await canvas.rfInstance?.setViewport(sourceViewport,{duration:0});
      }
      return false;
    }
    const currentShell = useLcosShellStore.getState();
    if (currentShell.worksiteCameraTransition?.id !== transitionId) return false;


    const loaded = await useCanvasStore.getState().switchCanvas(targetCanvasId);
    const latestShell = useLcosShellStore.getState();
    if (latestShell.worksiteCameraTransition?.id !== transitionId) return false;
    if (!loaded) {
      latestShell.consumeWorksiteCameraTransition(transitionId);
      if (sourceViewport && useCanvasStore.getState().canvasId === sourceCanvasId) {
        void canvas.rfInstance?.setViewport(sourceViewport, { duration: 0 });
      }
      return false;
    }
    if (input.signal?.aborted) {
      // The native loader has settled. Revert only our own still-current entry,
      // never a later navigation or another project's loaded scene.
      if (useLcosShellStore.getState().projectId !== input.projectId
        || useCanvasStore.getState().canvasId !== targetCanvasId) {
        latestShell.consumeWorksiteCameraTransition(transitionId);
        return false;
      }
      if (sourceCanvasId) {
        // A failed return must not leave the source URL above the target canvas.
        // If the native owner cannot restore, finish the already-loaded entry
        // truthfully and retain Back rather than announcing a cancelled entry.
        try { await useCanvasStore.getState().switchCanvas(sourceCanvasId); } catch { /* Inspect the actual canvas below. */ }
        const afterRestore = useLcosShellStore.getState();
        if (afterRestore.worksiteCameraTransition?.id !== transitionId
          || afterRestore.projectId !== input.projectId) return false;
        if (useCanvasStore.getState().canvasId === sourceCanvasId) {
          afterRestore.consumeWorksiteCameraTransition(transitionId);
          if (sourceViewport) await useCanvasStore.getState().rfInstance?.setViewport(sourceViewport,{duration:0});
          return false;
        }
        if (useCanvasStore.getState().canvasId !== targetCanvasId) {
          afterRestore.consumeWorksiteCameraTransition(transitionId);
          return false;
        }
      }
    }
    latestShell.beginChildNavigation({
      projectId: input.projectId,
      sourceSurface: input.sourceSurface,
      ...(input.sourceWorkspaceId === undefined ? {} : { sourceWorkspaceId: input.sourceWorkspaceId }),
      sourceWasChild: input.sourceWasChild,
      ...(sourceCanvasId === null ? {} : { sourceCanvasId }),
      ...(sourceViewport === undefined ? {} : { sourceViewport }),
      ...(sourceApproachViewport === undefined ? {} : { sourceApproachViewport }),
      selectedNodeIds: selectedNodes.map((node) => node.id),
      ...(sourceEntityRefs.length === 0 ? {} : { sourceEntityRefs }),
    });
    {
      const targetViewport = useCanvasStore.getState().viewport ?? useCanvasStore.getState().rfInstance?.getViewport();
      latestShell.updateWorksiteCameraTransition(transitionId, {
        ...(targetViewport === undefined
          ? {}
          : {
              startViewport: entryStartViewport(targetViewport, worksiteCameraViewportSize()),
              targetViewport,
            }),
      });
    }
    input.navigate(
      `/projects/${encodeURIComponent(input.projectId)}/${input.targetSurface}?workspaceId=${encodeURIComponent(String(input.targetWorkspace.id))}`,
    );
    return true;
  } catch {
    const latestShell = useLcosShellStore.getState();
    if (latestShell.worksiteCameraTransition?.id === transitionId) {
      latestShell.consumeWorksiteCameraTransition(transitionId);
      if (sourceViewport && useCanvasStore.getState().canvasId === sourceCanvasId) {
        void canvas.rfInstance?.setViewport(sourceViewport, { duration: 0 });
      }
    }
    return false;
  }
}
