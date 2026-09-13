// Neutral node body-slot seam (T1 Glyth seam) — the stable Context that
// carries the host app's body seam from <Canvas /> down to the native node
// body junction (NodeWrapper / NoteNode).
//
// The seam is deliberately domain-free: it only receives Huabu node facts and
// resolves a body component or `undefined` (native body). Huabu owns the
// Context here; the host app (LCOS) provides the seam value through its host
// extension (see types.ts CanvasHostExtension). The seam is REACTIVE: the
// host app notifies listeners when the resolution may have changed (e.g. a
// ProjectionBinding arrives after reconcile), so a late binding swaps the
// body in place on the same node without rebuilding it.

import { createContext, useContext, useSyncExternalStore } from 'react';

import type {
  CanvasNodeBodySeam,
  CanvasNodeBodySlotInput,
} from './types';

/**
 * Stable context carrying the host app's body seam.
 * `undefined` = no extension / no override — native bodies everywhere.
 * The provider value must be a stable reference (the host extension is
 * built once per runtime).
 */
export const NodeBodyResolverContext = createContext<
  CanvasNodeBodySeam | undefined
>(undefined);

/**
 * Resolve the replacement body for a native node, subscribing to the host
 * app's binding-change notifications so a late binding swaps the body in
 * place (same nodeId/geometry/selection, body only).
 */
export function useResolvedNodeBody(
  input: CanvasNodeBodySlotInput,
): React.ComponentType<CanvasNodeBodySlotInput> | undefined {
  const seam = useContext(NodeBodyResolverContext);
  return useSyncExternalStore(
    seam?.subscribe ?? (() => () => undefined),
    () => seam?.resolve(input) ?? undefined,
    () => seam?.resolve(input) ?? undefined,
  );
}
