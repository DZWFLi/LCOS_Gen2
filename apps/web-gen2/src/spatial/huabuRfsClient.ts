// Huabu RFS client — the formal Spatial Port for LCOS Gen2.
// Mirrors upstream microsoft/Huabu protocol v2 (packages/shared/src/types/api/
// space-operations.ts + packages/shared/src/types/canvas/command.ts) exactly for
// the transport surface. No guessing. No second spatial runtime.

import { HttpClient } from '../backend/client.js';
import {
  HUABU_PROTOCOL_VERSION,
  type CanvasNodeType,
  type Point,
  type NodeSize,
  type Rect,
  type EdgeStyle,
  type SpaceQueryResponse,
  type RfsExecuteResponse,
  type RfsCapabilitiesResponse,
  type EdgeLineType,
  type EdgeLineStyle,
  type EdgeDirection,
} from './types.js';

export interface RfsConfig {
  canvasId: string;
  baseUrl: string;
  bearerToken: string;
  fetch?: typeof fetch;
}

// ---------- Queries (SpaceQuery, upstream space-operations.ts) ----------

export type SpaceQuery =
  | { type: 'GET_SPACE_OUTLINE'; includePreviews?: boolean; includeStyle?: boolean }
  | {
      type: 'INSPECT_NODES';
      ids?: string[];
      byType?: CanvasNodeType | CanvasNodeType[];
      byParent?: string | null;
      labelPattern?: string;
      inRect?: Rect;
      nearNode?: { id: string; maxDistance?: number; maxCount?: number; sameParent?: boolean };
      nearPoint?: { x: number; y: number; maxDistance?: number; maxCount?: number };
      inSameClusterAs?: string;
      connectedTo?: { id: string; depth?: 1 | 2 };
      sort?: 'distance' | 'reading-order' | 'area';
      limit?: number;
    }
  | {
      type: 'INSPECT_EDGES';
      ids?: string[];
      connectedTo?: string;
      bySource?: string;
      byTarget?: string;
      between?: { a: string; b: string };
      byDirection?: EdgeDirection | EdgeDirection[];
      byLineStyle?: EdgeLineStyle | EdgeLineStyle[];
      byLineType?: EdgeLineType | EdgeLineType[];
      byLabel?: string;
      limit?: number;
    }
  | {
      type: 'SEARCH';
      query: string;
      limit?: number;
      nodeTypes?: string[];
      nodeId?: string;
      fields?: Array<'label' | 'summary' | 'keywords' | 'content' | 'conversation'>;
    }
  | { type: 'SNAPSHOT_NODES'; nodeIds: string[]; maxPixels?: number; strokeSubsets?: { nodeId: string; strokeIds: string[] }[] };

// ---------- Commands (AgentCanvasCommand, upstream space-operations.ts) ----------

export type NodeCreateInputByType = {
  nodeType: CanvasNodeType;
  data?: { label?: string; content?: string; src?: string; style?: Record<string, unknown> };
  position: Point;
  size?: NodeSize;
  parentId?: string | null;
  selectOnCreate?: boolean;
};

export type CanvasNodeCreateInput = NodeCreateInputByType;

export type CanvasEdgeRef = string | { source: string; target: string };

export type AgentCanvasCommand =
  | { type: 'CREATE_NODES'; nodes: CanvasNodeCreateInput[] }
  | { type: 'DELETE_NODES'; nodeIds: string[] }
  | { type: 'MERGE_NODE_DATA'; patches: { nodeId: string; patch: Record<string, unknown>; expectRev?: string; expectViewRev?: string }[] }
  | { type: 'SET_NODE_PARENT'; nodeIds: string[]; parentId: string | null }
  | { type: 'DISSOLVE_FRAME'; frameId: string }
  | { type: 'SET_NODE_GEOMETRY'; items: { nodeId: string; position?: Point; size?: NodeSize }[] }
  | { type: 'REORDER_NODES'; nodeIds: string[]; to: 'top' | 'bottom' | { before: string } | { after: string } }
  | { type: 'CONNECT_NODES'; edges: { source: string; target: string; style?: EdgeStyle }[] }
  | { type: 'DISCONNECT_EDGES'; edges: CanvasEdgeRef[] }
  | { type: 'SET_EDGE_STYLE'; edges: { edge: CanvasEdgeRef; style: Partial<EdgeStyle> }[] }
  | { type: 'ALIGN_NODES'; nodeIds: string[]; direction: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' }
  | { type: 'DISTRIBUTE_NODES'; nodeIds: string[] }
  | { type: 'SET_FRAME_LAYOUT'; frameId: string; mode: 'free' | 'column' | 'row' | 'grid'; gridCount?: number; gridRowCount?: number; sizing?: 'hug' | 'manual'; cells?: { nodeId: string; column?: number; row?: number }[] }
  | { type: 'SET_PORTAL_NODE_PINS'; updates: { sourceCanvasId: string; sourceNodeIds: string[]; pinned: boolean }[] };

export class RfsContractError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`RFS contract error: ${reason}`);
    this.name = 'RfsContractError';
    this.reason = reason;
  }
}

export class HuabuRfsClient {
  readonly config: RfsConfig;
  private readonly http: HttpClient;

  constructor(config: RfsConfig) {
    this.config = config;
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      token: config.bearerToken,
      fetch: config.fetch,
    });
  }

  get rfsUrl(): string {
    return `${this.config.baseUrl}/api/rfs/${this.config.canvasId}`;
  }

  /** Fetch capabilities and fail-fast if protocol v2 is not satisfied. */
  async assertProtocol(): Promise<RfsCapabilitiesResponse> {
    const caps = await this.capabilities();
    if (caps.protocolVersion !== HUABU_PROTOCOL_VERSION) {
      throw new RfsContractError(
        `protocolVersion mismatch: expected ${HUABU_PROTOCOL_VERSION}, got ${caps.protocolVersion}`,
      );
    }
    return caps;
  }

  async capabilities(): Promise<RfsCapabilitiesResponse> {
    return this.http.getJson<RfsCapabilitiesResponse>(`${this.rfsUrl}/capabilities`);
  }

  async query<Q extends SpaceQuery>(query: Q): Promise<SpaceQueryResponse & { type: Q['type'] }> {
    const res = await this.http.postJson<SpaceQueryResponse>(`${this.rfsUrl}/query`, query);
    return res as SpaceQueryResponse & { type: Q['type'] };
  }

  /** Execute commands. Throws on any command whose `applied !== true`. */
  async execute(commands: AgentCanvasCommand[]): Promise<RfsExecuteResponse> {
    const res = await this.http.postJson<RfsExecuteResponse>(`${this.rfsUrl}/execute`, { commands });
    for (const result of res.results ?? []) {
      if (result.applied !== true) {
        throw new RfsContractError(
          `command ${result.index} (${result.type}) not applied: ${result.reason ?? 'unknown'}`,
        );
      }
    }
    return res;
  }

  /** Execute but return raw response without throwing on per-command failure. */
  async executeRelaxed(commands: AgentCanvasCommand[]): Promise<RfsExecuteResponse> {
    return this.http.postJson<RfsExecuteResponse>(`${this.rfsUrl}/execute`, { commands });
  }

  async skillDoc(): Promise<string> {
    return this.http.getText(`${this.rfsUrl}/skill`);
  }

  async download(relativePath: string, signal?: AbortSignal): Promise<Blob> {
    return this.http.getBlob(`${this.rfsUrl}/download/${relativePath}`, signal);
  }

  /** Extract the first created node id from a CREATE result (protocol v2). */
  static firstCreatedNodeId(response: RfsExecuteResponse): string | undefined {
    return response.results?.[0]?.nodes?.[0]?.nodeId;
  }

  /** Extract the first created edge id from a CONNECT result (protocol v2). */
  static firstCreatedEdgeId(response: RfsExecuteResponse): string | undefined {
    return response.results?.[0]?.edges?.[0]?.edgeId;
  }

  async outline(): Promise<SpaceQueryResponse & { type: 'GET_SPACE_OUTLINE' }> {
    return this.query({ type: 'GET_SPACE_OUTLINE' });
  }
}
