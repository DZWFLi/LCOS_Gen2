// LCOS host seam — adaptive node presentation context (Phase A02).
//
// The Huabu NodeWrapper publishes, for every node it wraps, a neutral
// "presentation input" snapshot (world size, zoom, derived screen size,
// DPR, interaction phase). External host renderers consume it through
// `useLcosNodePresentation()` and resolve their own information density
// (the LCOS resolver lives in web-gen2 `presentation/nodePresentation.ts`).
//
// This file is deliberately domain-free: no density semantics, no species,
// only the data every adaptive renderer needs and the generic interaction
// phase priority.

import { createContext, useContext } from 'react';

/** Generic interaction phase priority for a wrapped node. */
export type NodeInteractionPhase =
  | 'rest'
  | 'hover'
  | 'selected'
  | 'editing'
  | 'dragging'
  | 'resizing';

/** Inputs accepted by {@link resolveInteractionPhase}. */
export interface InteractionPhaseInput {
  readonly editing: boolean;
  readonly selected: boolean;
  readonly isDragging: boolean;
  readonly isResizing: boolean;
  readonly hovered: boolean;
}

/**
 * Resolve the single interaction phase. Priority (highest first):
 * editing > resizing > dragging > selected > hovered > rest.
 * A node can only be in ONE phase — gestures are mutually exclusive.
 */
export function resolveInteractionPhase(
  input: InteractionPhaseInput,
): NodeInteractionPhase {
  if (input.editing) return 'editing';
  if (input.isResizing) return 'resizing';
  if (input.isDragging) return 'dragging';
  if (input.selected) return 'selected';
  if (input.hovered) return 'hover';
  return 'rest';
}

/**
 * The neutral presentation input published by NodeWrapper.
 * Structurally identical to web-gen2's `NodePresentationInput` (the two
 * declarations stay in sync via structural typing — the resolver on the
 * Gen2 side consumes this shape directly).
 */
export interface LcosNodePresentationInput {
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly zoom: number;
  readonly dpr: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly phase: NodeInteractionPhase;
}

/**
 * Absent when the component is not rendered inside a NodeWrapper
 * (e.g. a preview outside the canvas). Consumers must treat `undefined`
 * as "no adaptive data — render a static reasonable default".
 */
export const LcosNodePresentationContext = createContext<
  LcosNodePresentationInput | undefined
>(undefined);

/** Convenience provider component. */
export const LcosNodePresentationProvider = LcosNodePresentationContext.Provider;

/**
 * Read the adaptive presentation input of the wrapping NodeWrapper.
 * Returns `undefined` outside a wrapped node.
 */
export function useLcosNodePresentation(): LcosNodePresentationInput | undefined {
  return useContext(LcosNodePresentationContext);
}
