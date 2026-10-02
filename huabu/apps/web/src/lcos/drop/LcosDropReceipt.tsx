import { CoreRailwayClient } from '@local-creative-os/web-gen2';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { createPortal } from 'react-dom';
import { Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useHudViewport } from '../navigation/useHudViewport';
import { LcosButton } from '../ui/primitives/LcosButton';
import { LcosIconButton } from '../ui/primitives/LcosIconButton';
import useCanvasStore from '@/store/canvasStore';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { lcosGlassStyle } from '../ui/lcosTokens';
import { dropSourceKey } from './dropAssemblyReceipt';
import type { AssemblyApplyItemResultV1 } from '@local-creative-os/contracts';
import '../ui/nearfield/drop-feedback.css';

const itemStatus = (item: AssemblyApplyItemResultV1): string => item.channel === 'unsupported' ? '不支持'
  : item.status === 'failed' ? '失败' : item.status === 'applied' ? '已加入'
    : item.channel === 'already-member' ? '已在目标中' : '未应用';

/** One near-field receipt for the existing gesture. No new window, no second mutation owner. */
export function LcosDropReceipt(): React.JSX.Element | null {
  const state = useLcosDropStore((s) => s.state);
  const feedback = useLcosDropStore((s) => s.feedback);
  const dismiss = useLcosDropStore((s) => s.dismissFeedback);
  const retry = useLcosDropStore((s) => s.retryFailed);
  const hideSuccess = useLcosDropStore((s) => s.hideSuccessfulFeedback);
  const [detailsId, setDetailsId] = useState<string>();
  const [engaged, setEngaged] = useState(false);
  const bindings = useLcosReferenceStore((s) => s.nodeEntityRefs);
  const wrapper = useCanvasStore((s) => s.canvasWrapper);
  const viewport = useHudViewport();
  const panel = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState(64);
  const [checking,setChecking] = useState(false);
  const [lookupMessage,setLookupMessage] = useState<string>();
  const lookupController = useRef<AbortController | null>(null);
  useEffect(() => {setLookupMessage(undefined);setChecking(false);return ()=>lookupController.current?.abort();},[feedback?.receipt.transactionId]);
  const checkRailway = async (): Promise<void> => {
    const current=useLcosDropStore.getState().feedback;
    if (!current?.receipt.railwayOperationId || checking) return;
    const intent=current.originalIntent.intent;
    if (intent.kind!=='assembly-apply' || !intent.railwayDestinationRef || !('projectId' in intent.railwayDestinationRef)) return;
    const controller=new AbortController();lookupController.current=controller;setChecking(true);setLookupMessage(undefined);
    try {
      const client = new CoreRailwayClient(createLcosCoreSession().http);
      const result=await (intent.portalReceive ? client.portalReceipt.bind(client) : client.receiveReceipt.bind(client))(intent.railwayDestinationRef.projectId,current.receipt.railwayOperationId,controller.signal);
      if (!controller.signal.aborted && !useLcosDropStore.getState().confirmRailwayReceipt(current.receipt.transactionId,result))
        setLookupMessage('回执与当前投递不一致，未更改显示。');
    } catch(error) {if(!controller.signal.aborted)setLookupMessage(error instanceof Error?error.message:'尚未查到回执，未重新投递。');}
    finally{if(!controller.signal.aborted)setChecking(false);}
  };
  const busy = state.status === 'committing';
  const receipt = feedback?.receipt;
  const detailsOpen = receipt !== undefined && detailsId === receipt.transactionId;
  // A focused close button can disappear without a blur event. Do not carry that
  // engagement into the next gesture and leave its success feedback stuck open.
  useLayoutEffect(() => {
    const element = panel.current;
    setEngaged(Boolean(element && (element.contains(document.activeElement) || element.matches(':hover'))));
  }, [busy, receipt?.transactionId, feedback?.hidden]);
  useEffect(() => {
    if (busy || receipt?.status !== 'success' || detailsOpen || engaged || feedback?.hidden) return;
    const timer = window.setTimeout(() => {
      hideSuccess(receipt.transactionId);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [busy, receipt, detailsOpen, engaged, hideSuccess, feedback?.hidden]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const update = () => { const measured = element.getBoundingClientRect().height; if (measured > 0) setHeight(measured); };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [busy, receipt, viewport, detailsOpen]);
  if (!busy && (feedback === null || feedback.hidden)) return null;
  const attempt = busy ? state : feedback?.attempt;
  if (!attempt || attempt.status !== 'committing') return null;
  const target = useLcosDropStore.getState().targets().find((item) => item.targetId === attempt.destination.targetId);
  const rect = wrapper?.getBoundingClientRect();
  const targetRect = target?.readRect?.() ?? target?.rect;
  const availableWidth = viewport.width;
  const availableHeight = viewport.height;
  const width = Math.max(120, Math.min(receipt?.status !== 'success' || detailsOpen ? 340 : 280, availableWidth - 24));
  const anchorX = target?.kind !== 'canvas' && targetRect ? targetRect.left : (rect?.left ?? 0) + attempt.destination.previewPoint.x;
  const anchorY = target?.kind !== 'canvas' && targetRect ? targetRect.top : (rect?.top ?? 0) + attempt.destination.previewPoint.y;
  const title = busy ? '正在投放…' : receipt?.message ?? (receipt?.status === 'success' ? '投放完成' : '投放未完成');
  const success = receipt?.status === 'success';
  const showDetails = !busy && (!success || detailsOpen);
  const hasDetails = Boolean(receipt?.assemblyItems?.length || receipt?.collectionItems?.length);
  return createPortal(<section ref={panel} data-lcos-drop-receipt data-status={busy ? 'committing' : receipt?.status}
    className="lcos-drop-receipt" aria-label="投放结果" data-presentation={success && !detailsOpen ? 'compact' : 'detail'}
    onPointerEnter={() => setEngaged(true)} onPointerLeave={() => { if (!panel.current?.contains(document.activeElement)) setEngaged(false); }}
    onFocusCapture={() => setEngaged(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEngaged(false); }}
    style={{ ...lcosGlassStyle, position: 'fixed', width, maxHeight: Math.min(280, availableHeight - 24), left: Math.max(12, Math.min(anchorX - width - 12, availableWidth - width - 12)),
      top: Math.max(12, Math.min(anchorY - height - 12, availableHeight - height - 12)) }}
    onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); if (detailsOpen && success) setDetailsId(undefined); else if (success) hideSuccess(receipt!.transactionId); else dismiss(); } }}>
    <div className="lcos-drop-receipt-heading" role={busy || success ? 'status' : 'alert'}>
      {busy ? <LoaderCircle size={17} className="lcos-drop-spinner" aria-hidden /> : success ? <Check size={17} aria-hidden /> : <span aria-hidden>!</span>}
      <span><strong>{title}</strong>{target && <small>{target.label}</small>}</span>
      {!busy && <LcosIconButton appearance="oreo" variant="ghost" title="关闭投放结果" aria-label="关闭投放结果" onClick={() => success ? hideSuccess(receipt!.transactionId) : dismiss()}><X size={16} /></LcosIconButton>}
    </div>
    {!busy && success && hasDetails && <LcosButton appearance="oreo" variant="ghost" aria-expanded={detailsOpen}
      data-lcos-drop-details onClick={() => setDetailsId(detailsOpen ? undefined : receipt!.transactionId)}>{detailsOpen ? '收起详情' : '查看详情'}</LcosButton>}
    {showDetails && receipt?.assemblyItems && <ul aria-label="逐项投放结果">
      {receipt.assemblyItems.map((item, index) => {
        const ref = [...bindings.values()].find((candidate) => item.sourceRef.kind === 'artifactView'
          ? (candidate.entityType === 'view' && candidate.entityId === item.sourceRef.id) || candidate.descriptor?.artifactViewId === item.sourceRef.id
          : candidate.entityId === item.sourceRef.id && candidate.entityType === item.sourceRef.kind);
        const label = ref?.descriptor?.title || `材料 ${index + 1}`;
        const outcome = receipt.unknownSourceKeys?.includes(dropSourceKey(item.sourceRef)) ? '未确认' : itemStatus(item);
        return <li key={dropSourceKey(item.sourceRef)} data-outcome={outcome}>
          <span><strong>{label}</strong>{item.message && (outcome === '未确认' || item.status === 'failed' || item.channel === 'unsupported') && <small>{item.message}</small>}</span><em>{outcome}</em>
        </li>;
      })}
    </ul>}
    {showDetails && receipt?.collectionItems && <ul aria-label="逐项集合成员结果">
      {receipt.collectionItems.map((item, index) => {
        const binding = [...bindings.values()].find((ref) => ref.entityType === item.memberRef.type && ref.entityId === item.memberRef.id);
        const outcome = item.status === 'success' ? '关系已保存' : item.status === 'partial' ? '显示待同步' : '未确认';
        return <li key={`${item.memberRef.type}:${item.memberRef.id}`} data-outcome={item.status === 'failed' ? '失败' : outcome}>
          <span><strong>{binding?.descriptor?.title || `对象 ${index + 1}`}</strong>{item.message && <small>{item.message}</small>}</span><em>{outcome}</em>
        </li>;
      })}
    </ul>}
    {!busy && receipt?.railwayOperationId && receipt.status !== 'success' && <LcosButton appearance="oreo" variant="ghost" disabled={checking} onClick={()=>void checkRailway()}>
      <RotateCcw size={14} aria-hidden />{checking?'正在核对原投递…':'核对原投递（不重发）'}
    </LcosButton>}
    {lookupMessage&&<p role="status">{lookupMessage}</p>}
    {!busy && Boolean(receipt?.retrySourceRefs?.length) && <LcosButton appearance="oreo" variant="ghost" onClick={() => retry(crypto.randomUUID())}>
      <RotateCcw size={14} aria-hidden />只重试失败项（{receipt?.retrySourceRefs?.length}）
    </LcosButton>}
  </section>, document.body);
}
