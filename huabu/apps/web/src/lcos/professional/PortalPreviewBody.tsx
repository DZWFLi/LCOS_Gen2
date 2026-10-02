// P01/P02/P06: immutable workspace identity, native read-only preview, explicit entry.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/_client';
import { SpacePreviewViewport } from '@/components/Nodes/spacePreview/SpacePreviewViewport';
import useCanvasStore from '@/store/canvasStore';
import { useSpacePreviewScene } from '@/store/spacePreviewSceneCache';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { PortalPreviewView } from '../ui/professional/PortalPreviewView';
import type { LcosPortalPreviewState } from '../ui/families';

export interface PortalTargetResolution {
  readonly canvasId: string;
  readonly workspaceId: string;
  readonly targetSurface: 'main' | 'context' | 'workflow';
  readonly sourceNodeId?: string;
}
export interface PortalPreviewBodyProps {
  readonly projectId: string;
  readonly target?: string;
  readonly targetKind?: 'canvas';
  readonly workspaceId?: string;
  readonly sourceNodeId?: string;
  readonly portalTargetResolution?: PortalTargetResolution | null;
  readonly onOpenPortalTarget?: (target: PortalTargetResolution, signal?: AbortSignal) => Promise<boolean>;
  readonly onClose?: () => void;
}

export function PortalPreviewBody(props: PortalPreviewBodyProps): React.JSX.Element {
  // Older callers may provide a resolved identity. Capture it once: a later
  // canvas rebind must not turn an open preview into a different workspace.
  const [capturedId] = useState(() => props.workspaceId ?? props.portalTargetResolution?.workspaceId);
  const workspaceId = props.workspaceId ?? capturedId;
  if (!props.target || props.targetKind !== 'canvas' || !workspaceId) return <div className="lcos-portal-body">
    <PortalPreviewView state="目标缺失" title="入口目标预览" detail="原工作现场身份尚未确认；请从已有目的地重新打开入口。" />
  </div>;
  return <CanvasTargetPreview key={`${props.projectId}:${workspaceId}:${props.target}`} {...props} canvasId={props.target} workspaceId={workspaceId} />;
}

function CanvasTargetPreview({projectId,canvasId,workspaceId,sourceNodeId,onOpenPortalTarget,onClose}: PortalPreviewBodyProps & {
  readonly canvasId:string; readonly workspaceId:string;
}): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const hostCanvasId = useCanvasStore((s) => s.canvasId);
  const {scene,stale,error,retry} = useSpacePreviewScene(canvasId);
  const [zoomRequest,setZoomRequest] = useState<number>();
  const [identity,setIdentity] = useState<{target?:PortalTargetResolution; label?:string; error?:string; loading:boolean}>({loading:true});
  const [busy,setBusy] = useState<'open'|'assembly'|null>(null);
  const [message,setMessage] = useState<string>();
  const [refresh,setRefresh] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const readIdentity = useCallback(async (signal:AbortSignal) => {
    const actual = await session.railway.portalTarget(projectId,workspaceId,signal);
    if (!actual.available || actual.ref.kind !== 'worksite' || actual.ref.projectId !== projectId || actual.ref.worksiteId !== workspaceId
      || actual.canvasId !== canvasId || !['main','context','workflow'].includes(actual.surface ?? ''))
      throw new Error(actual.reason ?? '原入口的目标已变化；不会打开或投递到另一个现场。');
    return {target:{canvasId,workspaceId,targetSurface:actual.surface as PortalTargetResolution['targetSurface'],
      ...(sourceNodeId ? {sourceNodeId} : {})},label:actual.label};
  },[projectId,workspaceId,canvasId,sourceNodeId,session]);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setIdentity((previous) => ({...previous,loading:true}));
    void readIdentity(controller.signal).then((value) => { if (current) setIdentity({...value,loading:false}); })
      .catch((error) => { if (current) setIdentity({loading:false,error:error instanceof Error ? error.message : '入口身份读取失败。'}); });
    return () => { current=false;controller.abort(); };
  },[readIdentity,refresh]);
  useEffect(() => {
    alive.current = true;
    return () => {alive.current=false;operation.current?.abort();};
  },[]);
  useEffect(() => {
    const cancel = (event:KeyboardEvent) => { if (event.key === 'Escape' && operation.current) {event.preventDefault();event.stopImmediatePropagation();operation.current.abort();setMessage('正在取消当前操作，等待现场状态确认。');} };
    window.addEventListener('keydown',cancel,true);
    return () => window.removeEventListener('keydown',cancel,true);
  },[]);
  const act = async (kind:'open'|'assembly') => {
    if (operation.current || !identity.target || identity.loading) return;
    const controller = new AbortController(); operation.current=controller;setBusy(kind);setMessage(undefined);
    const sourceCanvasId = useCanvasStore.getState().canvasId;
    let entryCompleted = false;
    try {
      if (kind === 'open') {
        if (!onOpenPortalTarget) throw new Error('现场导航尚未连接。');
        const opened = await onOpenPortalTarget(identity.target,controller.signal);
        entryCompleted = opened;
        if (!opened && !controller.signal.aborted) throw new Error('现场未能打开，仍保留原入口，请重试。');
      } else {
        const current = await readIdentity(controller.signal);
        if (controller.signal.aborted || useCanvasStore.getState().canvasId !== sourceCanvasId
          || useLcosShellStore.getState().projectId !== projectId) throw new Error('来源已变化，未切换装配目标。');
        useLcosShellStore.getState().openAssembly({kind:'workspace',id:current.target.workspaceId},`装配 · ${current.label}`,false);
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '操作未确认，请重试。');
    } finally {
      if (operation.current === controller) operation.current=null;
      if (alive.current) {setBusy(null);if(controller.signal.aborted)setMessage(entryCompleted ? '现场已经打开，取消未能恢复来源；请使用返回来源。' : '操作已取消，未重新发送。');}
    }
  };
  const missing = error instanceof ApiError && error.status === 404;
  const matchingScene = scene?.canvasId === canvasId ? scene : null;
  const state:LcosPortalPreviewState = identity.error || missing ? '目标缺失' : identity.loading ? '加载中'
    : matchingScene ? stale || error ? '旧缓存' : matchingScene.truncated.nodes || matchingScene.truncated.edges ? '部分预览' : '可预览'
    : error ? '预览失败' : '加载中';
  const detail = identity.error ?? (missing ? '目标现场已不存在或无法访问。' : state === '旧缓存' ? '显示上次读取的画面，最新内容暂未确认。'
    : state === '部分预览' ? '内容较多，当前仅显示部分对象。' : state === '预览失败' ? '目标画面读取失败，可以重试。'
    : state === '可预览' ? '只读预览 · 此处缩放不会移动主画布' : '正在读取原目标现场…');
  const reload = () => {setRefresh((n)=>n+1);retry();};
  return <div className="lcos-portal-body" data-lcos-portal-workspace={workspaceId}>
    <PortalPreviewView state={state} title={identity.label || matchingScene?.title || '入口目标预览'} detail={detail}
      onOpen={() => void act('open')} openBusy={busy === 'open'}
      openDisabled={!!busy || identity.loading || !identity.target || !onOpenPortalTarget}
      {...(identity.error ? {openDisabledReason:identity.error} : {})}
      {...(error || stale || state === '部分预览' || identity.error ? {onRetry:reload} : {})}
      {...(matchingScene ? {onZoom:()=>setZoomRequest((n)=>(n??0)+1)} : {})}>
      {matchingScene && !missing && !identity.error && <div data-lcos-real-portal-preview>
        <SpacePreviewViewport scene={matchingScene} hostCanvasId={hostCanvasId} previewNodeId={`portal-window:${workspaceId}`}
          hostZoom={1} zoomRequest={zoomRequest} />
      </div>}
    </PortalPreviewView>
    <div className="lcos-portal-actions">
      <button type="button" disabled={!!busy || !identity.target || identity.loading} onClick={()=>void act('assembly')}>{busy === 'assembly' ? '核对目标…' : '装配'}</button>
      {busy ? <button type="button" onClick={()=>{operation.current?.abort();setMessage('正在取消当前操作…');}}>取消当前操作</button> : null}
      {onClose ? <button type="button" onClick={onClose}>收回</button> : null}
    </div>
    {message && <p className="lcos-portal-action-message" role="status" aria-live="polite">{message}</p>}
  </div>;
}
