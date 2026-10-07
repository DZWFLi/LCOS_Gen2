import { computeLocatorGeometry, toScreenRect } from '@local-creative-os/web-gen2';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Tooltip } from '@/components/Common/Tooltip';
import { layoutLocatorMarkers } from './locatorMarkerLayout';
import { LOCATOR_HUD_OBSTACLES, useHudObstacleRects } from './useHudObstacleRects';
import { getReliableNodeBounds } from '@/components/Panels/CanvasLayerPanel/focusNodesOnCanvas';
import useCanvasStore from '@/store/canvasStore';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useOptionalLcosColorPins } from '../pin/LcosColorPinProvider';
import { projectedPinTargets, type ProjectedPinTarget } from '../pin/projectedPinTargets';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';
import { LcosSpatialCursorMark } from './LcosSpatialCursorMark';
import { useHudViewport } from './useHudViewport';

/** Screen-space projection of actual marked or explicitly selected objects. No camera/state owner. */
export function LcosPersistentLocatorOverlay(): React.JSX.Element | null {
  const rf = useReactFlow();
  const viewport = useViewport();
  const screen = useHudViewport();
  const hudObstacles = useHudObstacleRects(LOCATOR_HUD_OBSTACLES);
  const nodes = useCanvasStore((state) => state.nodes);
  const canvasId = useCanvasStore((state) => state.canvasId);
  const refs = useLcosReferenceStore((state) => state.nodeEntityRefs);
  const pin = useOptionalLcosColorPins();
  const environment = useLcosShellStore((state) => state.windowEnvironment);
  const surface = useLcosShellStore((state) => state.activeSurface);
  const request = useLcosShellStore((state) => state.locateRequest);
  const requestLocate = useLcosShellStore((state) => state.requestLocate);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const root = document.querySelector('.react-flow');
    if (!(root instanceof HTMLElement)) { setRect(null); return; }
    const measure = (): void => setRect(root.getBoundingClientRect());
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [canvasId, screen.width, screen.height]);
  if (!rect || rect.width <= 0 || rect.height <= 0 || !canvasId) return null;
  const safe = environment?.safeRect;
  const safeRect = { left: Math.max(rect.left, safe?.x ?? rect.left), top: Math.max(rect.top, safe?.y ?? rect.top),
    right: Math.min(rect.right, safe ? safe.x + safe.width : rect.right), bottom: Math.min(rect.bottom, safe ? safe.y + safe.height : rect.bottom) };
  if (safeRect.right - safeRect.left < 64 || safeRect.bottom - safeRect.top < 64) return null;
  const pinned = pin ? projectedPinTargets(nodes, refs, pin) : [];
  const pinnedIds = new Set(pinned.map((target) => target.nodeId));
  const selected: ProjectedPinTarget[] = nodes.filter((node) => node.selected && !node.hidden && !pinnedIds.has(node.id))
    .map((node) => ({ nodeId: node.id, label: refs.get(node.id)?.descriptor?.title ?? refs.get(node.id)?.displayLabel ?? '所选对象', colors: [] }));
  const occupied = [...(environment?.occupiedRects ?? []), ...hudObstacles].map(toScreenRect);
  const currentRequestTargets = new Set(request?.nodeIds ?? (request?.nodeId ? [request.nodeId] : []));
  const candidates = [...pinned, ...selected].flatMap((target) => {
    if (currentRequestTargets.has(target.nodeId)) return [];
    const bounds = getReliableNodeBounds(rf, [target.nodeId]);
    if (!bounds) return [];
    const targetRect = { left: rect.left + bounds.x * viewport.zoom + viewport.x,
      top: rect.top + bounds.y * viewport.zoom + viewport.y,
      right: rect.left + (bounds.x + bounds.width) * viewport.zoom + viewport.x,
      bottom: rect.top + (bounds.y + bounds.height) * viewport.zoom + viewport.y };
    const geometry = computeLocatorGeometry({ targetRect, safeRect, edgeInset: 26, nearEdgeDistance: 72 });
    // Local marks belong to the node agent. Locator only takes over as the target approaches the edge.
    if (geometry.state === 'local') return [];
    const edge = geometry.edgeAnchor ?? geometry.directionAnchor ?? geometry.targetCenter;
    const progress = geometry.progress;
    const origin = { x: targetRect.right - 10, y: targetRect.top + 10 };
    const anchor = { x: origin.x + (edge.x - origin.x) * progress,
      y: origin.y + (edge.y - origin.y) * progress };
    return [{ target, geometry, progress, anchor, edge }];
  });
  const positions = layoutLocatorMarkers(candidates.map(({ target, progress, anchor, edge }) => ({
    id: target.nodeId, ...anchor, edgeX: edge.x, edgeY: edge.y, width: 44, height: 44,
  })), safeRect, occupied);
  const markers = candidates.map(({ target, geometry, progress }, index) => {
    const anchor = positions[index]!;
    const color = target.colors[0] ?? lcosTokens.color.accent;
    const pinSummary = target.colors.length === 0 ? '' : ` · ${target.colors.length} 个颜色组`;
    const angle = Math.atan2(geometry.direction.y, geometry.direction.x) * 180 / Math.PI;
    const horizontal = Math.abs(geometry.direction.x) >= Math.abs(geometry.direction.y);
    const labelPlacement = horizontal
      ? geometry.direction.x < 0 ? 'right' as const : 'left' as const
      : geometry.direction.y < 0 ? 'below' as const : 'above' as const;
    return <Tooltip key={target.nodeId} content={`${target.label}${pinSummary}`}>
      <button type="button" data-lcos-persistent-locator={geometry.state}
        data-lcos-locator-node={target.nodeId} data-lcos-locator-crowded={anchor.crowded || undefined}
        data-lcos-locator-kind={target.colors.length > 0 ? 'pin-target' : 'selection'}
        aria-label={`前往 ${target.label}${target.colors.length > 0 ? `（属于 ${target.colors.length} 个颜色组）` : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); requestLocate({ reqId: crypto.randomUUID(), surface, canvasId,
          nodeId: target.nodeId, status: 'projected', preserveSelection: true }); }}
        className="pointer-events-auto fixed z-[64] grid h-11 w-11 place-items-center rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ left: anchor.x, top: anchor.y, transform: 'translate(-50%, -50%)' }}>
        <LcosSpatialCursorMark surface={surface} phase={geometry.state} angleDeg={angle} progress={progress}
          accent={color} badge={target.colors.length}
          label={geometry.state === 'edge' ? target.label : undefined} />
      </button>
    </Tooltip>;
  });
  return <>{markers}</>;
}
