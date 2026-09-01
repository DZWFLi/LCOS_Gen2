// Huabu RFS client — the formal Spatial Port for Gen2.
// LCOS does NOT touch Huabu Space persistence internals; all spatial
// read/write goes through `/api/rfs/:canvasId/{query,execute,capabilities,download}`.

import { HttpClient, HttpError } from '../backend/client.js';
import type { Geometry, HuabuNodeInput } from './types.js';

export interface RfsConfig {
  canvasId: string;
  baseUrl: string;
  bearerToken: string;
  fetch?: typeof fetch;
}

export type Rect = { x: number; y: number; width: number; height: number };

export type RfsQuery =
  | { type: 'GET_SPACE_OUTLINE' }
  | { type: 'INSPECT_NODES'; ids?: string[]; byType?: string[]; nearNode?: string; connectedTo?: string; inRect?: Rect }
  | { type: 'INSPECT_EDGES'; ids?: string[]; connectedTo?: string; inRect?: Rect }
  | { type: 'SEARCH'; query: string; tier?: 'meta' | 'content' | 'conversation' }
  | { type: 'SNAPSHOT_NODES'; ids: string[] };

export type RfsCommand =
  | { type: 'CREATE_NODES'; nodes: HuabuNodeInput[] }
  | { type: 'DELETE_NODES'; nodeIds: string[] }
  | { type: 'MERGE_NODE_DATA'; changes: Array<{ id: string; data?: Record<string, unknown> }> }
  | { type: 'SET_NODE_PARENT'; changes: Array<{ id: string; parentId: string | null }> }
  | { type: 'SET_NODE_GEOMETRY'; changes: Array<{ id: string } & Geometry> }
  | { type: 'CONNECT_NODES'; connections: Array<{ source: string; target: string; style?: Record<string, unknown> }> }
  | { type: 'DISCONNECT_EDGES'; edgeIds: string[] }
  | { type: 'SET_EDGE_STYLE'; changes: Array<{ edgeId: string; style: Record<string, unknown> }> }
  | { type: 'ALIGN_NODES'; changes: Array<{ ids: string[]; axis: 'x' | 'y' | 'both'; anchor?: string }> }
  | { type: 'DISTRIBUTE_NODES'; changes: Array<{ ids: string[]; axis: 'x' | 'y' | 'both' }> }
  | { type: 'SET_FRAME_LAYOUT'; changes: Array<{ id: string; layoutMode: 'free' | 'column' | 'row' | 'grid' }> };

export interface RfsExecuteResult {
  id?: string;
  nodeId?: string;
  edgeId?: string;
  status?: string;
}

export interface RfsExecuteResponse {
  fromVersion?: number;
  toVersion?: number;
  results?: RfsExecuteResult[];
  revisions?: Array<{ nodeId: string; version?: number }>;
  affected?: unknown;
  conflicts?: Array<{ reason: 'not-read' | 'stale'; nodeId?: string; entityId?: string }>;
  createdNodes?: Array<{ id: string }>;
  createdEdges?: Array<{ id: string }>;
}

export interface RfsCapabilitiesResponse {
  protocolVersion?: string;
  permissions?: unknown;
  queryTypes?: string[];
  commandTypes?: string[];
  limits?: { maxCommands?: number };
  links?: Record<string, string>;
}

export interface RfsQueryResponse {
  nodes?: Array<{ id: string; type: string; position?: { x: number; y: number }; size?: { width: number; height: number }; label?: string; data?: Record<string, unknown> }>;
  edges?: Array<{ id: string; source: string; target: string; style?: Record<string, unknown> }>;
  hits?: Array<{ id: string; score?: number; snippet?: string; ref?: unknown }>;
  outline?: unknown;
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

  async capabilities(): Promise<RfsCapabilitiesResponse> {
    return this.http.get<RfsCapabilitiesResponse>(`${this.rfsUrl}/capabilities`);
  }

  async query<Q extends RfsQuery>(query: Q): Promise<RfsQueryResponse> {
    return this.http.post<RfsQueryResponse>(`${this.rfsUrl}/query`, query);
  }

  async execute(commands: RfsCommand[]): Promise<RfsExecuteResponse> {
    return this.http.post<RfsExecuteResponse>(`${this.rfsUrl}/execute`, { commands });
  }

  async skillDoc(): Promise<string> {
    return this.http.get<string>(`${this.rfsUrl}/skill`);
  }

  async download(relativePath: string, signal?: AbortSignal): Promise<Blob> {
    const res = await this.http.get<Blob>(`${this.rfsUrl}/download/${relativePath}`, signal);
    return res;
  }

  /** Convenience: read the whole outline (nodes + edges) of a Space. */
  async outline(): Promise<RfsQueryResponse> {
    return this.query({ type: 'GET_SPACE_OUTLINE' });
  }
}
