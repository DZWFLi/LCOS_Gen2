// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useCallback, useMemo, useState } from 'react';

import useCanvasStore from '@/store/canvasStore';

import { fitNodesOnCanvas } from '../CanvasLayerPanel/focusNodesOnCanvas';

import type { CanvasViewport } from '@huabu/shared';
import type { ReactFlowInstance } from '@xyflow/react';

type InitialCanvasViewport = {
  defaultViewport?: CanvasViewport;
  nodeIdsToFit: string[];
};

export interface InitialCanvasViewportOptions {
  /**
   * LCOS owns the first frame through `LcosCanvasCommands`, which can account
   * for the route-level HUD safe area and its projection completion signal.
   * The legacy fit would otherwise run first and zoom a sparse canvas to giant
   * text before LCOS gets a chance to frame it.
   */
  readonly deferFit?: boolean;
}

/** Restore a saved viewport or fit persisted node bounds on first mount. */
export const useInitialCanvasViewport = (
  options: InitialCanvasViewportOptions = {},
) => {
  const deferFit = options.deferFit === true;
  const initialViewport = useMemo<InitialCanvasViewport>(() => {
    const { viewport, nodes } = useCanvasStore.getState();
    if (viewport) return { defaultViewport: viewport, nodeIdsToFit: [] };
    return { nodeIdsToFit: nodes.map((node) => node.id) };
  }, []);
  const [isPending, setIsPending] = useState(
    initialViewport.nodeIdsToFit.length > 0 && !deferFit,
  );

  const fitInitialViewport = useCallback(
    (instance: ReactFlowInstance) => {
      if (deferFit) {
        setIsPending(false);
        return;
      }
      if (initialViewport.nodeIdsToFit.length === 0) return;

      try {
        void fitNodesOnCanvas(instance, initialViewport.nodeIdsToFit)
          .catch(() => false)
          .finally(() => setIsPending(false));
      } catch {
        // Guard against a synchronous throw leaving the overlay stuck and the
        // canvas permanently hidden.
        setIsPending(false);
      }
    },
    [deferFit, initialViewport.nodeIdsToFit],
  );

  return {
    defaultViewport: initialViewport.defaultViewport,
    fitInitialViewport,
    isPending,
  };
};
