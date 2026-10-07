import { FileText, Link2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SurfacePoint } from '@local-creative-os/web-gen2';

import useCanvasStore from '@/store/canvasStore';

import { resolveDropPointerTarget } from './drop/dropPointerResolution';
import { dropFeedbackPosition, isNearDropFeedback, nearestDropFeedbackPoint } from './drop/dropFeedbackGeometry';
import { useLcosDropStore } from './lcosDropState';
import { useLcosReferenceStore } from './lcosReferenceState';
import { FigmaShellGlyph } from './ui/FigmaShellGlyph';
import { lcosGlassStyle, lcosTokens } from './ui/lcosTokens';

import './ui/nearfield/drop-feedback.css';

/** Real payload thumbnail + local receiver feedback. No entity IDs or diagnostic taxonomy in the UI. */
export function LcosDropPreview(): React.JSX.Element | null {
  const state = useLcosDropStore((s) => s.state);
  const resolution = useLcosDropStore((s) => s.resolution);
  const nativeSource = useLcosDropStore((s) => s.nativeSource);
  const carrySourceNodeId = useLcosDropStore((s) => s.carrySourceNodeId);
  const carrySourceNodeIds = useLcosDropStore((s) => s.carrySourceNodeIds);
  const pointerScreenPoint = useLcosDropStore((s) => s.pointerScreenPoint);
  const sourceNodeId = carrySourceNodeId ?? nativeSource?.nodes[0]?.nodeId;
  const targets = useLcosDropStore((s) => s.targets);
  const source = useCanvasStore((s) => s.nodes.find((node) => node.id === sourceNodeId));
  const bindings = useLcosReferenceStore((s) => s.nodeEntityRefs);
  const wrapper = useCanvasStore((s) => s.canvasWrapper);
  const active = state.status === 'tracking' || state.status === 'dwell';
  const committing = state.status === 'committing';
  if (!active && state.status !== 'preview' && !committing) return null;

  const payload = state.payload;
  const targetList = targets(); // Registry.snapshot reads current geometry, not the registration rect.
  const destination = state.status === 'preview' || state.status === 'committing' ? state.destination : undefined;
  const target = destination ? targetList.find((item) => item.targetId === destination.targetId) : undefined;
  const rect = target?.rect;
  const canvasRect = wrapper?.getBoundingClientRect();
  // Legacy preview callers can still supply a destination; no-hit movement uses
  // the same transport's latest screen sample, never a second pointer listener.
  const pointer = pointerScreenPoint ?? (destination ? {
    x: (canvasRect?.left ?? 0) + destination.previewPoint.x,
    y: (canvasRect?.top ?? 0) + destination.previewPoint.y,
  } : undefined);
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;

  const ineligible = resolution?.status === 'ineligible';
  const ignored = new Set(nativeSource?.nodes.map((node) => node.nodeId) ?? carrySourceNodeIds);
  const candidates = active || target?.kind === 'canvas' ? targetList.flatMap((candidate) => {
    const liveRect = candidate.rect;
    if (candidate.kind === 'canvas' || (candidate.nodeId !== undefined && ignored.has(candidate.nodeId))
      || !isNearDropFeedback(liveRect, pointer)) return [];
    const nearest = nearestDropFeedbackPoint(liveRect, pointer)!;
    // Probe inside the exposed receiver. Clipped/covered rows must not glow
    // through a panel; this does not enlarge the actual drop hit area.
    const insetX = Math.min(.5, liveRect.width / 2);
    const insetY = Math.min(.5, liveRect.height / 2);
    const exposed = { x: Math.max(liveRect.left + insetX, Math.min(nearest.x, liveRect.left + liveRect.width - insetX)),
      y: Math.max(liveRect.top + insetY, Math.min(nearest.y, liveRect.top + liveRect.height - insetY)) };
    if (candidate.acceptsPoint && !candidate.acceptsPoint(exposed)) return [];
    const result = resolveDropPointerTarget(payload, candidate, {
      native: nativeSource !== null,
      rightCarry: carrySourceNodeId !== null,
      ...(nativeSource?.blockedReason === undefined ? {} : { blockedReason: nativeSource.blockedReason }),
    });
    return result.resolution?.status === 'ready' ? [{ target: candidate, rect: liveRect }] : [];
  }) : [];
  const sourceData = source?.data as Record<string, unknown> | undefined;
  const media = source?.type === 'image' && typeof sourceData?.src === 'string' ? sourceData.src : undefined;
  const binding = payload.kind === 'object'
    ? [...bindings.values()].find((ref) => ref.entityType === payload.entityType && ref.entityId === payload.entityId)
    : undefined;
  const payloadTitle = payload.kind === 'assembly' ? payload.reference?.displayLabel
    : payload.kind === 'object' ? payload.displayLabel
      : payload.kind === 'objects' ? payload.objects[0]?.displayLabel : undefined;
  const rawTitle = sourceData?.label ?? sourceData?.title ?? payloadTitle ?? binding?.descriptor?.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle
    : payload.kind === 'file' ? payload.name : payload.kind === 'url' ? '链接'
      : payload.kind === 'text' ? '文本片段' : '材料';
  const action = resolution?.status === 'ready'
    ? resolution.intent.kind === 'railway-bookmark' ? '固定整个空间到左侧 Rail · 原内容保留'
    : resolution.intent.kind === 'assembly-apply' && resolution.intent.targetRef.kind === 'conversation'
      ? `持久加入「${target?.label ?? '此会话'}」的上下文`
      : resolution.intent.kind === 'collection-membership' ? `加入集合「${target?.label ?? '目标集合'}」`
      : resolution.intent.kind === 'composer-reference' ? '仅加入本次草稿引用'
        : resolution.intent.kind === 'external-import' ? `导入到「${target?.label ?? '当前项目'}」`
          : target?.kind === 'portal-receive' ? `投递到「${target.label}」`
            : target?.kind === 'railway-receive' ? `投递到「${target.label}」`
            : `放入「${target?.label ?? '目标现场'}」`
    : '等待接收位置';
  const collectionId = resolution?.status === 'ready' && resolution.intent.kind === 'collection-membership' ? resolution.intent.collectionId : undefined;
  const visibleHost = collectionId !== undefined && useCanvasStore.getState().nodes.some((node) => node.type === 'frame'
    && node.data.lcosCollectionId === collectionId && !node.hidden && !node.data.locked
    && !useCanvasStore.getState().collapsedFrameIds.has(node.id));
  const count = nativeSource?.nodes.length ?? (payload.kind === 'objects' ? payload.objects.length : 1);
  const message = active ? '拖到接收空间 · 原内容保留'
    : committing ? `正在写入「${target?.label ?? '目标空间'}」 · 原内容保留`
    : ineligible ? `${target?.label ?? '这个位置'}：${resolution.reason}` : `${action}${nativeSource ? visibleHost ? ' · 在此落位' : ' · 源对象保留' : ''}`;
  const displayTitle = count > 1 ? `${title} 等 ${count} 项` : title;
  const receptorRect = rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
  const aggregateKind = payload.kind === 'assembly' ? payload.sourceRef.kind : undefined;
  const glyph = aggregateKind === 'collection' ? 'collection' : aggregateKind === 'context' ? 'context'
    : aggregateKind === 'workflow' ? 'workflow' : aggregateKind === 'scene' ? 'project' : undefined;

  return createPortal(<>
    {candidates.map(({ target: candidate, rect: candidateRect }) => (
      <div key={candidate.targetId} data-lcos-drop-receptor data-state="approaching"
        data-target-label={candidate.label} className="lcos-drop-receptor"
        aria-hidden="true" style={{
        position: 'fixed', left: candidateRect.left, top: candidateRect.top,
        width: candidateRect.width, height: candidateRect.height, boxSizing: 'border-box',
        borderRadius: candidate.kind === 'collaboration-reference' ? '50%' : 18,
      }} />
    ))}
    {(state.status === 'preview' || committing) && receptorRect && target?.kind !== 'canvas' && (
      <div data-lcos-drop-receptor data-state={committing ? 'committing' : ineligible ? 'rejected' : 'receptive'}
        data-target-label={target?.label}
        className="lcos-drop-receptor" aria-hidden="true" style={{
        position: 'fixed', left: receptorRect.left, top: receptorRect.top,
        width: receptorRect.width, height: receptorRect.height, boxSizing: 'border-box',
        borderRadius: target?.kind === 'collaboration-reference' ? '50%' : 18,
      }} />
    )}
    <DropPointerFeedback point={pointer} ineligible={ineligible} title={displayTitle} message={message}
      presentation={committing ? 'committing' : active ? 'carrying' : 'preview'}>
      {!nativeSource && <div data-lcos-carry-proxy className="lcos-drop-proxy" data-multiple={count > 1 || undefined} style={lcosGlassStyle} aria-hidden>
        {media ? <img src={media} alt="" draggable={false} /> : glyph ? <FigmaShellGlyph name={glyph} size={25} /> : <FileText size={25} strokeWidth={1.4} />}
        {count > 1 && <span data-lcos-drop-count>{count}</span>}
      </div>}
    </DropPointerFeedback>
  </>, document.body);
}

/** One persistent feedback element through carry -> approach -> preview.
 * Placement has no spring/transition: each accepted sample follows the pointer. */
function DropPointerFeedback({ point, ineligible, title, message, presentation, children }: {
  readonly point: SurfacePoint; readonly ineligible: boolean; readonly title: string;
  readonly message: string; readonly presentation: 'carrying' | 'preview' | 'committing'; readonly children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState(() => ({ width: 280, height: 64,
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }));
  useLayoutEffect(() => {
    const update = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setMeasure((previous) => previous.width === rect.width && previous.height === rect.height
        && previous.viewportWidth === window.innerWidth && previous.viewportHeight === window.innerHeight ? previous
        : { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const placement = dropFeedbackPosition(point, { width: measure.viewportWidth, height: measure.viewportHeight }, measure);
  return <div ref={ref} data-lcos-drop-preview data-presentation={presentation} data-feedback-side={placement.side}
    className="lcos-drop-feedback" role="status" style={{ position: 'fixed', left: placement.left, top: placement.top }}>
    {children}
    <div className="lcos-drop-caption" style={{ ...lcosGlassStyle, color: ineligible ? lcosTokens.color.muted : lcosTokens.color.text }}>
      {ineligible ? <X size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
      <span><strong>{title}</strong><small>{message}</small></span>
    </div>
  </div>;
}
