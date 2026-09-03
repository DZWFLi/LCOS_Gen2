// LcosCanvasAdapter — the ONLY React glue between the framework-agnostic
// Gen2 HostSeam and the Huabu Canvas host extension (Phase A01).
//
// web-gen2 stays React-free at runtime (the seam keeps renderers/overlays/
// recognizers opaque); this module is the place where those opaque
// descriptors are cast to their React types and reshaped into the neutral
// `CanvasHostExtension` consumed by Huabu's `<Canvas hostExtension={...} />`.
//
// The Huabu contract lives in huabu/apps/web/src/lcos-seam/types.ts.
// We cannot import across package roots, so the shape is re-declared here;
// structural typing keeps the two declarations in sync (a drift breaks
// typecheck on the Huabu side, where the real contract is consumed).

import type { ComponentType, ReactNode } from 'react';

import type { HostSeam, SemanticConnectOutcome } from '../../host/hostSeam.js';

/** Mirrors Huabu's `CanvasHostOverlay` (apps/web/src/lcos-seam/types.ts). */
export interface HuabuCanvasHostOverlay {
  readonly key: string;
  readonly node: ReactNode;
}

/** Mirrors Huabu's `CanvasHostRecognizer` (opaque pointer recognizer). */
export interface HuabuCanvasHostRecognizer {
  readonly id: string;
  // Intentionally opaque: the recognizer methods are DOM/React-dependent
  // (canClaim/onDown/onMove/...) and never imported into web-gen2.
  readonly [key: string]: unknown;
}

/**
 * Mirrors Huabu's `CanvasHostExtension` (apps/web/src/lcos-seam/types.ts).
 */
export interface HuabuCanvasHostExtension {
  readonly nodeTypes?: Readonly<Record<string, ComponentType<unknown>>>;
  readonly overlays?: readonly HuabuCanvasHostOverlay[];
  readonly recognizers?: readonly HuabuCanvasHostRecognizer[];
  /** Optional semantic connect (node-id based, domain-free). */
  readonly connectIntent?: {
    onConnectNodes(
      fromNodeId: string,
      toNodeId: string,
      surface: string,
    ): Promise<SemanticConnectOutcome>;
  };
}

/**
 * Convert a Gen2 HostSeam into the Huabu Canvas host extension.
 *
 * - Renderer descriptors become a `nodeTypes` record keyed by `lcos/*` keys.
 * - Overlay descriptors keep their stable keys (React keys for keyed fragments).
 * - Recognizer descriptors pass through as opaque router entries (A03).
 * - Empty collections collapse to `undefined` so Huabu stays 100% stock when
 *   the seam carries nothing.
 * - The result is a plain value: callers memoize it (the renderer map and
 *   recognizer array references must stay stable across renders or React
 *   Flow re-initializes / the router re-installs mid-gesture).
 */
export function hostExtensionFromSeam(seam: HostSeam): HuabuCanvasHostExtension {
  const nodeTypes: Record<string, ComponentType<unknown>> = {};
  for (const descriptor of seam.extraRenderers) {
    nodeTypes[descriptor.nodeType] = descriptor.renderer as ComponentType<unknown>;
  }

  const recognizers = seam.recognizers
    .map((descriptor) => descriptor.recognizer as HuabuCanvasHostRecognizer)
    .filter((recognizer) => typeof recognizer?.id === 'string');

  return {
    nodeTypes:
      Object.keys(nodeTypes).length > 0 ? nodeTypes : undefined,
    overlays:
      seam.overlays.length > 0
        ? seam.overlays.map((overlay) => ({
            key: overlay.key,
            node: overlay.node as ReactNode,
          }))
        : undefined,
    recognizers: recognizers.length > 0 ? recognizers : undefined,
    connectIntent: seam.connectIntent
      ? {
          onConnectNodes: (fromNodeId, toNodeId, surface) =>
            seam.connectIntent.onConnectNodes(fromNodeId, toNodeId, surface),
        }
      : undefined,
  };
}
