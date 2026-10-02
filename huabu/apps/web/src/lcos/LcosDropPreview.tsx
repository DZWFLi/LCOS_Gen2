import { FileText, Link2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import useCanvasStore from '@/store/canvasStore';

import { useLcosDropStore } from './lcosDropState';
import { useLcosReferenceStore } from './lcosReferenceState';
import { lcosGlassStyle, lcosTokens } from './ui/lcosTokens';

import './ui/nearfield/drop-feedback.css';

/** Real payload thumbnail + local receiver feedback. No entity IDs or diagnostic taxonomy in the UI. */
export function LcosDropPreview(): React.JSX.Element | null {
  const state = useLcosDropStore((s) => s.state);
  const resolution = useLcosDropStore((s) => s.resolution);
  const nativeSource = useLcosDropStore((s) => s.nativeSource);
  const sourceNodeId = useLcosDropStore((s) => s.carrySourceNodeId) ?? nativeSource?.nodes[0]?.nodeId;
  const targets = useLcosDropStore((s) => s.targets);
  const source = useCanvasStore((s) => s.nodes.find((node) => node.id === sourceNodeId));
  const bindings = useLcosReferenceStore((s) => s.nodeEntityRefs);
  const wrapper = useCanvasStore((s) => s.canvasWrapper);
  if (state.status !== 'preview') return null;

  const { destination, payload } = state;
  const target = targets().find((item) => item.targetId === destination.targetId);
  const rect = target?.readRect ? target.readRect() : target?.rect;
  const canvasRect = wrapper?.getBoundingClientRect();
  const ineligible = resolution?.status === 'ineligible';
  const sourceData = source?.data as Record<string, unknown> | undefined;
  const media = source?.type === 'image' && typeof sourceData?.src === 'string' ? sourceData.src : undefined;
  const binding = payload.kind === 'object'
    ? [...bindings.values()].find((ref) => ref.entityType === payload.entityType && ref.entityId === payload.entityId)
    : undefined;
  const rawTitle = sourceData?.label ?? sourceData?.title ?? binding?.descriptor?.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle
    : payload.kind === 'file' ? payload.name : payload.kind === 'url' ? '链接'
      : payload.kind === 'text' ? '文本片段' : '材料';
  const action = resolution?.status === 'ready'
    ? resolution.intent.kind === 'assembly-apply' && resolution.intent.targetRef.kind === 'conversation'
      ? `持久加入「${target?.label ?? '此会话'}」的上下文`
      : resolution.intent.kind === 'collection-membership' ? `加入集合「${target?.label ?? '目标集合'}」`
      : resolution.intent.kind === 'composer-reference' ? '仅加入本次草稿引用'
        : resolution.intent.kind === 'external-import' ? `导入到「${target?.label ?? '当前项目'}」`
          : target?.kind === 'portal-receive' ? `投递到「${target.label}」`
            : target?.kind === 'railway-receive' ? `投递到 Railway · ${target.label}`
            : `放入「${target?.label ?? '目标现场'}」`
    : '等待接收位置';
  const collectionId = resolution?.status === 'ready' && resolution.intent.kind === 'collection-membership' ? resolution.intent.collectionId : undefined;
  const visibleHost = collectionId !== undefined && useCanvasStore.getState().nodes.some((node) => node.type === 'frame'
    && node.data.lcosCollectionId === collectionId && !node.hidden && !node.data.locked
    && !useCanvasStore.getState().collapsedFrameIds.has(node.id));
  const message = ineligible ? resolution.reason : `${action}${nativeSource ? visibleHost ? ' · 在此落位' : ' · 源对象保留' : ''}`;
  const displayTitle = nativeSource && nativeSource.nodes.length > 1 ? `${title} 等 ${nativeSource.nodes.length} 项` : title;

  return createPortal(<>
    {!ineligible && rect && canvasRect && target?.kind !== 'canvas' && (
      <div data-lcos-drop-receptor className="lcos-drop-receptor" aria-hidden style={{
        position: 'fixed', left: rect.left - 5, top: rect.top - 5,
        width: rect.width + 10, height: rect.height + 10,
        borderRadius: target?.kind === 'collaboration-reference' ? '50%' : 18,
      }} />
    )}
    <div data-lcos-drop-preview className="lcos-drop-feedback" role="status"
      style={{ position: 'fixed', left: Math.max(0, Math.min((canvasRect?.left ?? 0) + destination.previewPoint.x, window.innerWidth - 300)), top: Math.max(0, Math.min((canvasRect?.top ?? 0) + destination.previewPoint.y, window.innerHeight - 105)) }}>
      {!nativeSource && <div data-lcos-carry-proxy className="lcos-drop-proxy" style={lcosGlassStyle} aria-hidden>
        {media ? <img src={media} alt="" draggable={false} /> : <FileText size={25} strokeWidth={1.4} />}
      </div>}
      <div className="lcos-drop-caption" style={{ ...lcosGlassStyle, color: ineligible ? lcosTokens.color.muted : lcosTokens.color.text }}>
        {ineligible ? <X size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
        <span><strong>{displayTitle}</strong><small>{message}</small></span>
      </div>
    </div>
  </>, document.body);
}
