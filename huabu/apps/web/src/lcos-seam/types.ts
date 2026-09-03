// LCOS host seam — neutral canvas extension contract.
//
// This is the ONLY shape the Huabu Canvas exposes to an external host app.
// It is deliberately domain-free: no LCOS Core types, no entity refs, no
// projection semantics. The host app (LCOS) supplies concrete renderers,
// overlays and pointer recognizers; Huabu only merges and mounts them.
//
// Renderer key convention: external hosts register under their own namespace
// (e.g. `lcos/entity`, `lcos/conversation`). Built-in Huabu keys can never
// be overridden — see mergeNodeTypes.

import type { ComponentType, ReactNode } from 'react';
import type { PointerRecognizer } from '@/handler/pointerRouter';
import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';

/**
 * A node renderer supplied by the host app. Deliberately mirrors React
 * Flow's own `NodeTypes` value looseness (`ComponentType<any>`): opaque
 * host-side adapters (whose props generics we cannot know here) must stay
 * structurally assignable, exactly like the stock nodeTypes map.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExternalNodeRenderer = ComponentType<any>;

/** A canvas-level overlay with a stable identity (React key). */
export interface CanvasHostOverlay {
  readonly key: string;
  readonly node: ReactNode;
}

/**
 * Semantic connect seam, node-id based and deliberately domain-free: the
 * canvas gesture only knows Huabu node ids, and the host app resolves them
 * back to Core entities (A05). Returns the ready edge id when a semantic edge
 * was projected (undefined if the edge binding is not captured yet).
 */
export type CanvasConnectOutcome =
  | { readonly kind: 'ok'; readonly edgeId?: string }
  | { readonly kind: 'native'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface CanvasHostConnectIntent {
  onConnectNodes(
    fromNodeId: string,
    toNodeId: string,
    surface: string,
  ): Promise<CanvasConnectOutcome>;
}

/** A pointer recognizer wired into the canvas pointer router. */
export type CanvasHostRecognizer = PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
>;

/**
 * The single extension surface consumed by `<Canvas />`.
 * All fields optional; an absent extension leaves Huabu 100% stock.
 */
export interface CanvasHostExtension {
  /** Host node renderers, merged OVER (never replacing) Huabu built-ins. */
  readonly nodeTypes?: Readonly<Record<string, ExternalNodeRenderer>>;
  /** Canvas-level overlays rendered above the canvas, keyed by `key`. */
  readonly overlays?: readonly CanvasHostOverlay[];
  /** Extra pointer recognizers appended to the router's recognizer chain. */
  readonly recognizers?: readonly CanvasHostRecognizer[];
  /** Optional semantic connect: a node-id connect gesture -> Core relation -> edge. */
  readonly connectIntent?: CanvasHostConnectIntent;
}
