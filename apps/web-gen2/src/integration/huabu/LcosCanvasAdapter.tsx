// LcosCanvasAdapter — the ONLY React glue between the framework-agnostic
// Gen2 HostSeam and the Huabu Canvas host extension (Phase A01).
//
// web-gen2 stays React-free at runtime (the seam keeps renderers/overlays
// opaque); this module is the place where those opaque descriptors are cast
// to their React types and reshaped into the neutral `CanvasHostExtension`
// consumed by Huabu's `<Canvas hostExtension={...} />`.
//
// The Huabu contract lives in microsoft/Huabu apps/web/src/lcos-seam/types.ts.
// We cannot import across repos, so the shape is re-declared here; structural
// typing keeps the two declarations in sync (a drift breaks typecheck on the
// Huabu side, where the real contract is consumed).

import type { ComponentType, ReactNode } from 'react';

import type { HostSeam } from '../../host/hostSeam.js';

/** Mirrors Huabu's `CanvasHostOverlay` (apps/web/src/lcos-seam/types.ts). */
export interface HuabuCanvasHostOverlay {
  readonly key: string;
  readonly node: ReactNode;
}

/**
 * Mirrors Huabu's `CanvasHostExtension` (apps/web/src/lcos-seam/types.ts).
 * Pointer recognizers arrive with the A03 pointer-intent wiring and are
 * therefore not part of this adapter's output yet.
 */
export interface HuabuCanvasHostExtension {
  readonly nodeTypes?: Readonly<Record<string, ComponentType<unknown>>>;
  readonly overlays?: readonly HuabuCanvasHostOverlay[];
}

/**
 * Convert a Gen2 HostSeam into the Huabu Canvas host extension.
 *
 * - Renderer descriptors become a `nodeTypes` record keyed by `lcos/*` keys.
 * - Overlay descriptors keep their stable keys (React keys for keyed fragments).
 * - Empty collections collapse to `undefined` so Huabu stays 100% stock when
 *   the seam carries nothing.
 * - The result is a plain value: callers memoize it (the renderer map
 *   reference must stay stable across renders or React Flow re-initializes).
 */
export function hostExtensionFromSeam(seam: HostSeam): HuabuCanvasHostExtension {
  const nodeTypes: Record<string, ComponentType<unknown>> = {};
  for (const descriptor of seam.extraRenderers) {
    nodeTypes[descriptor.nodeType] = descriptor.renderer as ComponentType<unknown>;
  }

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
  };
}
