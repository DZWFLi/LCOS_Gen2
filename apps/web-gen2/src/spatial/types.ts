// Spatial / RFS projection types for LCOS Gen2.
// Huabu is Spatial Truth; LCOS Core is Domain Truth. These types only
// describe the *projection* boundary, never a second spatial model.

export type NodeType =
  | 'note'
  | 'text'
  | 'image'
  | 'pdf'
  | 'office'
  | 'video'
  | 'audio'
  | 'web'
  | 'frame'
  | 'sketch'
  | 'question'
  | 'spacePreview'
  | 'canvasRef'
  | 'frameRef'
  | 'nodeRef';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Geometry = Point & Partial<Size>;

export interface HuabuNodeInput {
  type: NodeType;
  label?: string;
  geometry?: Geometry;
  data?: Record<string, unknown>;
}

export interface HuabuNode {
  id: string;
  type: NodeType;
  position: Point;
  size?: Size;
  label?: string;
  data?: Record<string, unknown>;
}

export interface HuabuEdgeStyle {
  lineType?: 'bezier' | 'straight' | 'step';
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  stroke?: string;
  strokeWidth?: 2 | 4 | 8 | 16;
  direction?: 'none' | 'forward' | 'backward' | 'both';
  label?: string;
}

export interface HuabuEdge {
  id: string;
  source: string;
  target: string;
  style?: HuabuEdgeStyle;
}
