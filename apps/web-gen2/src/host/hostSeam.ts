// Host seam contract — the LCOS side of the Huabu Canvas seam. The Huabu thin
// fork (Canvas.tsx) consumes the neutral `CanvasHostExtension` shape
// (apps/web/src/lcos-seam/types.ts):
//   - nodeTypes: custom LCOS node renderers keyed by a Huabu node type name
//     (namespace convention: `lcos/<species>`)
//   - overlays: canvas-level LCOS overlays, each with a stable key
//   - recognizers: pointer recognizers appended to Huabu's router chain (A03)
//   - connectIntent: a semantic connect handler (from/to/kind -> Core Relation ->
//     Huabu Edge), wired to Gen2Host.connect
// Framework-agnostic: renderers/overlays are opaque (the host app supplies React
// nodes); the contract stays type-checked without pulling React into the
// boundary. The React glue lives in integration/huabu/LcosCanvasAdapter.tsx.

import type { Gen2Host } from './projectionFacade.js';
import type { CoreEntityRef } from '../spatial/relationProjection.js';
import type { RelationKind } from '../spatial/relationProjection.js';

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

export interface SemanticConnectIntent {
  kind: RelationKind;
  /** Returns the created Core relation id + the projected Huabu edge id. */
  onConnect(from: CoreEntityRef, to: CoreEntityRef): Promise<{ relationId: string; changeSetId: string; edgeId: string | undefined }>;
}

export interface HostSeam {
  extraRenderers: LcosRendererDescriptor[];
  overlays: LcosOverlayDescriptor[];
  connectIntent: SemanticConnectIntent;
}

/** Optional injections when building the seam (A01: renderer registration). */
export interface HostSeamOptions {
  /** Renderer descriptors to expose via the seam (e.g. `lcos/artifact`). */
  readonly renderers?: readonly LcosRendererDescriptor[];
  /** Keyed overlay descriptors to render above the canvas. */
  readonly overlays?: readonly LcosOverlayDescriptor[];
}

/**
 * Build the seam the Huabu Canvas fork consumes, wiring the connect-intent to
 * Gen2Host.connect (Core Relation -> Huabu Edge). Renderers/overlays are
 * supplied by the host app via the descriptors; this factory wires the
 * semantic path.
 */
export function createHostSeam(host: Gen2Host, options: HostSeamOptions = {}): HostSeam {
  return {
    extraRenderers: [...(options.renderers ?? [])],
    overlays: [...(options.overlays ?? [])],
    connectIntent: {
      kind: 'references',
      onConnect: async (from, to) => {
        const result = await host.connect(from, to, 'references');
        return { relationId: result.relationId, changeSetId: result.changeSetId, edgeId: result.edgeBinding?.spatialId };
      },
    },
  };
}
