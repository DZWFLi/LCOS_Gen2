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

import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';
import type { ComponentType, ReactNode } from 'react';

/**
 * Neutral body-slot input for the T1 Glyth seam. Deliberately domain-free:
 * only Huabu node facts (id / native type / node data) plus the default
 * body; no LCOS entity types, no projection semantics.
 */
export interface CanvasNodeBodySlotInput {
  readonly nodeId: string;
  readonly nodeType: string;
  /** Huabu node data — opaque; a resolved body component reads what it needs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly data: Readonly<Record<string, any>>;
}

/**
 * Neutral binding-aware body resolver (T1 Glyth seam). The host app resolves
 * a native node's body override from nodeId + native type + node data;
 * returning `undefined` keeps the native body untouched. Only the host app
 * decides which nodes get a replacement body (e.g. conversation-bound
 * nodes) — this seam never knows LCOS/Conversation specifics.
 */
export type CanvasNodeBodyResolver = (
  input: CanvasNodeBodySlotInput,
) => ComponentType<CanvasNodeBodySlotInput> | undefined;

/**
 * Reactive handle for the body seam. The resolution may change asynchronously
 * (e.g. the host app's binding cache is still syncing); the consumer
 * subscribes so a late binding swaps the body in place on the same node.
 * `subscribe` returns an unsubscribe function. `resolve` must return a
 * stable value for a stable input (component reference or undefined) so the
 * consumer can diff snapshots without churn.
 */
export interface CanvasNodeBodySeam {
  readonly resolve: CanvasNodeBodyResolver;
  readonly subscribe: (listener: () => void) => () => void;
}

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
  /**
   * Optional neutral body seam (T1 Glyth seam): resolves a replacement body
   * for a native node from nodeId + native type + node data, and notifies the
   * native node body junction when the resolution may have changed (late
   * binding). Consumed via a stable context (see nodeBodySlot.tsx) — never
   * replaces a built-in node renderer, never a second renderer registry.
   */
  readonly resolveNodeBody?: CanvasNodeBodySeam;
}
