// Spatial / RFS projection types for LCOS Gen2.
// Huabu = Spatial Truth; LCOS Core = Domain Truth. These types mirror Huabu
// protocol v2 contracts (upstream microsoft/Huabu, pinned) exactly for the
// transport surface only. Never a second spatial model.

export const HUABU_PROTOCOL_VERSION = 2;

// CANVAS_NODE_TYPES (upstream packages/shared/src/types/canvas/node.ts)
export const CANVAS_NODE_TYPES = [
  'note', 'text', 'image', 'pdf', 'office', 'video', 'audio', 'web',
  'frame', 'spacePreview', 'canvasRef', 'frameRef', 'nodeRef',
  'sketch', 'question',
] as const;
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

// AGENT_CREATABLE_NODE_TYPES (upstream node.ts)
export const AGENT_CREATABLE_NODE_TYPES = [
  'note', 'text', 'web', 'image', 'pdf', 'office', 'video', 'frame', 'question',
] as const;
export type AgentCreatableNodeType = (typeof AGENT_CREATABLE_NODE_TYPES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface NodeGeometrySize {
  width: number;
  height?: number | 'auto';
}

export type NodeSize = NodeGeometrySize;

export type Geometry = Point & Partial<NodeSize>;

export const EDGE_LINE_TYPES = ['bezier', 'straight', 'step'] as const;
export type EdgeLineType = (typeof EDGE_LINE_TYPES)[number];
export const EDGE_LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type EdgeLineStyle = (typeof EDGE_LINE_STYLES)[number];
export const EDGE_DIRECTIONS = ['none', 'forward', 'backward', 'both'] as const;
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number];
export const EDGE_STROKE_WIDTHS = [2, 4, 8, 16] as const;
export type EdgeStrokeWidth = (typeof EDGE_STROKE_WIDTHS)[number];

export interface PersistedEdgeStyle {
  lineType?: EdgeLineType;
  lineStyle?: EdgeLineStyle;
  stroke?: string;
  strokeWidth?: EdgeStrokeWidth | number;
  direction?: EdgeDirection;
  label?: string;
  labelSource?: 'auto' | 'user' | 'agent';
}

export type AgentRfsEdgeStyle = Omit<PersistedEdgeStyle, 'labelSource'>;

export type EdgeStyle = AgentRfsEdgeStyle;

export const NODE_FONT_FAMILIES = ['default', 'serif', 'mono', 'hand'] as const;
export type NodeFontFamily = (typeof NODE_FONT_FAMILIES)[number];
export const NODE_FONT_WEIGHTS = ['normal', 'bold'] as const;
export type NodeFontWeight = (typeof NODE_FONT_WEIGHTS)[number];

export interface NodeStyle {
  accent?: string | null;
  fontFamily?: NodeFontFamily;
  fontWeight?: NodeFontWeight;
  fontStyle?: string;
  fontSize?: number;
  textDecoration?: string;
}

export interface AgentNodeDataPatch {
  label?: string;
  content?: string;
  src?: string;
  style?: NodeStyle;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelSource = 'auto' | 'user' | 'agent';

export interface SpaceNodeResult {
  id: string;
  type: CanvasNodeType;
  label?: string;
  filename: string;
  summary?: string;
  preview?: string;
  rev?: string;
  parentFrame?: { id: string; label?: string };
  position: { x: number; y: number };
  absolutePosition: { x: number; y: number };
  size: { width: number; height: number };
  style?: Record<string, unknown>;
}

export interface SpaceOutlineResult {
  version: number;
  bbox: Rect | null;
  nodes: SpaceNodeResult[];
  edges: { id?: string; source: string; target: string }[];
  spatial: { clusters: { frameId?: string; frameLabel?: string; nodeIds: string[]; arrangement: string }[] };
}

export interface InspectNodesResult {
  count: number;
  total: number;
  truncated: boolean;
  arrangement?: string;
  nodes: (SpaceNodeResult & {
    distance?: number;
    centerDistance?: number;
    direction?: 'left' | 'right' | 'above' | 'below';
    edgeIds?: string[];
    hops?: 1 | 2;
    clusterId?: string;
  })[];
}

export interface InspectEdgesResult {
  count: number;
  total: number;
  truncated: boolean;
  edges: {
    id?: string;
    source: string;
    target: string;
    lineType?: EdgeLineType;
    lineStyle?: EdgeLineStyle;
    stroke?: string;
    strokeWidth?: number;
    direction?: EdgeDirection;
    label?: string;
    labelSource?: LabelSource;
  }[];
}

export interface SearchResult {
  count: number;
  truncated: boolean;
  matches: {
    tier: 'meta' | 'content' | 'conversation';
    match: {
      kind?: 'node' | 'edge';
      nodeId: string;
      nodeType: string;
      label: string | null;
      field: 'label' | 'summary' | 'keywords' | 'content' | 'conversation';
      snippet: string;
      matchStart: number;
      matchLength: number;
      occurrenceIndex: number;
      sourceNodeId?: string;
      targetNodeId?: string;
    };
  }[];
}

export interface SnapshotNodesResult {
  snapshots: {
    src: string;
    downloadPath: string;
    width: number;
    height: number;
    originNodeIds: string[];
  }[];
}

export type SpaceQueryResponse =
  | { type: 'GET_SPACE_OUTLINE'; result: SpaceOutlineResult }
  | { type: 'INSPECT_NODES'; result: InspectNodesResult }
  | { type: 'INSPECT_EDGES'; result: InspectEdgesResult }
  | { type: 'SEARCH'; result: SearchResult }
  | { type: 'SNAPSHOT_NODES'; result: SnapshotNodesResult };

export interface ExecuteResultNode {
  nodeId: string;
  label?: string;
  width: number;
  height: number;
  src?: string;
}

export interface ExecuteResultEdge {
  edgeId: string;
  source: string;
  target: string;
}

export type CommandFailureReason =
  | 'no-op'
  | 'not-found'
  | 'invalid-parent'
  | 'invalid-target'
  | 'invalid-scope'
  | 'cycle'
  | 'duplicate-id'
  | 'conflict';

export interface RfsExecuteResponse {
  canvasId: string;
  runId: string;
  fromVersion: number;
  toVersion: number;
  commands: unknown[];
  results: {
    index: number;
    type: string;
    applied: boolean;
    reason?: CommandFailureReason;
    nodes?: ExecuteResultNode[];
    edges?: ExecuteResultEdge[];
  }[];
  revisions: { nodeId: string; rev: string }[];
  affected: {
    nodeIds: string[];
    edgeIds: string[];
    deletedNodeIds: string[];
    deletedEdgeIds: string[];
  };
  conflicts?: { nodeId: string; reason: 'not-read' | 'stale'; expectedRev?: string; currentRev: string }[];
}

export interface RfsCapabilitiesResponse {
  protocolVersion: 2;
  permissions: { read: boolean; write: boolean };
  execution: { atomic: false; partialCommit: true; idempotent: false; runIdIsIdempotencyKey: false };
  limits: {
    queryDefault: number;
    queryMax: number;
    searchDefault: number;
    searchMax: number;
    executeMaxCommands: number;
    snapshotMaxNodes: number;
  };
  queryTypes: string[];
  commandTypes: string[];
  links: { skill: string; query: string; execute: string; queryCapabilityTemplate: string; commandCapabilityTemplate: string };
}
