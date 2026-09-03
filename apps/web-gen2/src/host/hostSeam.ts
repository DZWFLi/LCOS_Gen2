// Host seam contract — the LCOS side of the Huabu Canvas seam. The Huabu thin
// fork (Canvas.tsx) consumes the neutral `CanvasHostExtension` shape
// (apps/web/src/lcos-seam/types.ts):
//   - nodeTypes: custom LCOS node renderers keyed by a Huabu node type name
//     (namespace convention: `lcos/<species>`)
//   - overlays: canvas-level LCOS overlays, each with a stable key
//   - recognizers: pointer recognizers appended to Huabu's router chain (A03)
//   - connectIntent: a semantic connect handler (from/to/kind -> Core Relation ->
//     Huabu Edge), wired to Gen2Host.connect
// Framework-agnostic: renderers/overlays/recognizers are opaque (the host app
// supplies React/DOM values); the contract stays type-checked without pulling
// React into the boundary. The React glue lives in
// integration/huabu/LcosCanvasAdapter.tsx.

import type { Gen2Host } from './projectionFacade.js';
import { resolveConnectKind, type ConnectIntentContext, type SurfaceKey } from './hostConnectIntent.js';

export type LcosNodeTypeName = string;

export interface LcosRendererDescriptor {
  /** Huabu node type key. Must be namespaced (`lcos/*`); built-ins are refused by mergeNodeTypes. */
  nodeType: LcosNodeTypeName;
  /** Opaque renderer (React component in the host app). */
  renderer: unknown;
}

export interface LcosOverlayDescriptor {
  /** Stable React key for the overlay. */
  key: string;
  /** Opaque overlay React node. */
  node: unknown;
}

/** Opaque pointer recognizer supplied by the host app (Huabu PointerRecognizer). */
export interface LcosRecognizerDescriptor {
  recognizer: unknown;
}

export interface SemanticConnectIntent {
  /**
   * Semantic connect: given the gesture context (endpoints + optional ports +
   * surface), RESOLVE the Core relation kind (never hardcoded here — A05),
   * create the Core relation first, then project the Huabu edge.
   */
  onConnect(ctx: ConnectIntentContext): Promise<{ relationId: string; changeSetId: string; edgeId: string | undefined }>;
  /**
   * Node-id seam variant: the Huabu canvas gesture only knows node ids, so
   * this translates them back to Core entity refs, resolves the kind and
   * projects the edge. Returns the ready Huabu edge id (undefined if a
   * binding/uist already projected it but the edge binding isn't captured).
   */
  onConnectNodes(fromNodeId: string, toNodeId: string, surface: SurfaceKey): Promise<SemanticConnectOutcome>;
}

/**
 * A05/A09: Core-first connect decision. ok -> Core Relation projected as edge.
 * 
ative -> at least one endpoint has no Core binding (native-only node), host
 *   MAY fall back to the stock Huabu connect (no Core relation created).
 * 

ejected -> Core refused / capability unsupported: MUST NOT create a native
 *   edge (fail-close, audit P0-4). 
eason is user-visible.
 */
export type SemanticConnectOutcome =
  | { readonly kind: 'ok'; readonly edgeId?: string }
  | { readonly kind: 'native'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string };

export interface HostSeam {
  extraRenderers: LcosRendererDescriptor[];
  overlays: LcosOverlayDescriptor[];
  recognizers: LcosRecognizerDescriptor[];
  connectIntent: SemanticConnectIntent;
}

/** Optional injections when building the seam (A01: renderer registration; A03: recognizers). */
export interface HostSeamOptions {
  /** Renderer descriptors to expose via the seam (e.g. `lcos/artifact`). */
  readonly renderers?: readonly LcosRendererDescriptor[];
  /** Keyed overlay descriptors to render above the canvas. */
  readonly overlays?: readonly LcosOverlayDescriptor[];
  /** Pointer recognizers to append to Huabu's canvas pointer router. */
  readonly recognizers?: readonly LcosRecognizerDescriptor[];
}

/**
 * Build the seam the Huabu Canvas fork consumes, wiring the connect-intent to
 * Gen2Host.connect (Core Relation -> Huabu Edge). Renderers/overlays/
 * recognizers are supplied by the host app via the descriptors; this factory
 * wires the semantic path.
 */
export function createHostSeam(host: Gen2Host | (() => Gen2Host), options: HostSeamOptions = {}): HostSeam {
  const getHost = (): Gen2Host => (typeof host === 'function' ? host() : host);
  return {
    extraRenderers: [...(options.renderers ?? [])],
    overlays: [...(options.overlays ?? [])],
    recognizers: [...(options.recognizers ?? [])],
    connectIntent: {
      onConnect: async (ctx) => {
        const resolution = resolveConnectKind(ctx);
        if (!resolution.ok) {
          throw new Error(`Connect refused: ${resolution.reason}`);
        }
        const result = await getHost().connect(ctx.from, ctx.to, resolution.kind);
        return { relationId: result.relationId, changeSetId: result.changeSetId, edgeId: result.edgeBinding?.spatialId };
      },
      onConnectNodes: async (fromNodeId, toNodeId, surface) => {
        const h = getHost();
        const from = await h.resolveNode(fromNodeId);
        const to = await h.resolveNode(toNodeId);
        if (!from || !to) {
          return { kind: 'native', reason: 'endpoint without a Core binding (native-only node)' };
        }
        const resolution = resolveConnectKind({ from: { entityType: from.entityType, entityId: from.entityId }, to: { entityType: to.entityType, entityId: to.entityId }, surface });
        if (!resolution.ok) {
          return { kind: 'rejected', reason: resolution.reason };
        }
        try {
          const result = await h.connect(from, to, resolution.kind);
          return { kind: 'ok', edgeId: result.edgeBinding?.spatialId };
        } catch (error) {
          return { kind: 'rejected', reason: error instanceof Error ? error.message : 'Core relation failed' };
        }
      },
    },
  };
}
