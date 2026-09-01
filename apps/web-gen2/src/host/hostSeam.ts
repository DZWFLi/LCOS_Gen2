// Host seam contract — the LCOS side of the Huabu Canvas seam. The Huabu thin
// fork (Canvas.tsx) consumes exactly this shape:
//   - extraRenderers: custom LCOS node renderers keyed by a Huabu node type name
//   - overlays: canvas-level LCOS overlays
//   - connectIntent: a semantic connect handler (from/to/kind -> Core Relation ->
//     Huabu Edge), wired to Gen2Host.connect.
// Framework-agnostic: renderers/overlays are opaque (the web app supplies React
// nodes); the contract stays type-checked without pulling React into the boundary.

import type { Gen2Host } from './projectionFacade.js';
import type { CoreEntityRef } from '../spatial/relationProjection.js';
import type { RelationKind } from '../spatial/relationProjection.js';

export type LcosNodeTypeName = string;

export interface LcosRendererDescriptor {
  nodeType: LcosNodeTypeName;
  /** Opaque renderer (React component in the host app). */
  renderer: unknown;
}

export interface LcosOverlayDescriptor {
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

/**
 * Build the seam the Huabu Canvas fork consumes, wiring the connect-intent to
 * Gen2Host.connect (Core Relation -> Huabu Edge). Renderers/overlays are supplied
 * by the host app via the descriptors; this factory wires the semantic path.
 */
export function createHostSeam(host: Gen2Host): HostSeam {
  return {
    extraRenderers: [],
    overlays: [],
    connectIntent: {
      kind: 'references',
      onConnect: async (from, to) => {
        const result = await host.connect(from, to, 'references');
        return { relationId: result.relationId, changeSetId: result.changeSetId, edgeId: result.edgeBinding?.spatialId };
      },
    },
  };
}
