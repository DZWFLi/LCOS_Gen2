// Project navigation: Core V1 identity/order; existing Huabu preview, Drop and navigation owners.
import { createId } from '@huabu/shared';
import { placeExistingWorkspacePortal } from '../navigation/portalPlacement';
import { useLcosHostStore } from '../host/lcosHostState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { railwayStableKeyV1 } from '@local-creative-os/contracts';
import type { ConnectedConversationV1, RailwayDestinationV1 } from '@local-creative-os/contracts';
import { CoreConversationClient, CoreRailwayClient, moveRailwayDestination } from '@local-creative-os/web-gen2';
import { ArrowDown, ArrowUp, Eye, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Popover } from '@/components/Common/Popover';
import useCanvasStore from '@/store/canvasStore';
import { lcosHudEdgeOffsets, lcosHudSafeCenterY } from './lcosHudPlacement';
import { useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { LcosReceiverIdentity } from '../composer/LcosReceiverIdentity';
import { isDropPointExposed } from '../drop/dropOcclusion';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import { useLcosDropStore } from '../lcosDropState';
import { RailwayPeek } from '../navigation/RailwayPeek';
import { railwayReceiveLabel, railwayReceivePresentation } from '../navigation/railwayReceivePresentation';
import { railwayDropGestureActive, railwayDynamicCapacity, railwayHiddenDestinations, railwayVisibleDestinations } from '../navigation/railwayDynamicLayout';
import { useAvoidingHudPosition } from '../navigation/useAvoidingHudPosition';
import { useHudViewport } from '../navigation/useHudViewport';
import { useRailwayDestinations } from '../navigation/useRailwayDestinations';
import { LcosRailwayView } from '../ui/families/LcosRailwayView';
import type { LcosRailwayViewItem } from '../ui/families/LcosRailwayView';
import { FigmaShellGlyph } from '../ui/FigmaShellGlyph';
import { LcosIconButton } from '../ui/primitives/LcosIconButton';
import { lcosGlassStyle } from '../ui/lcosTokens';
import '../ui/nearfield/railway-destinations.css';

const REORDER_MIME = 'application/x-lcos-railway-order';
const targetId = (projectId: string, key: string) => `railway:${projectId}:${key}`;
export interface LcosRailwayProps {
  readonly projectId: string;
  readonly surfaceByWorkspace: ReadonlyMap<string,LcosSurfaceKey>;
  readonly activateDestination: (destination: RailwayDestinationV1) => Promise<void> | void;
}
export function LcosRailway(props: LcosRailwayProps): React.JSX.Element {
  return <ProjectRailway key={props.projectId} {...props} />;
}
function ProjectRailway({projectId,activateDestination}: LcosRailwayProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(),[]);
  const railway = useMemo(() => new CoreRailwayClient(session.http),[session]);
  const conversations = useMemo(() => new CoreConversationClient(session.http),[session]);
  const data = useRailwayDestinations(projectId,railway);
  const {snapshot,status,busy,notice,setNotice,reload,update} = data;
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const environment = useLcosShellStore((s) => s.windowEnvironment);
  const openWindow = useLcosShellStore((s) => s.openWindow);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const watch = useCollaborationSessionStore((s) => s.watchProjectChanges);
  const drop = useLcosDropStore((s) => s.state);
  const resolution = useLcosDropStore((s) => s.resolution);
  const [receiver,setReceiver] = useState<ConnectedConversationV1>();
  const [receiverError,setReceiverError] = useState<string>();
  const receiverEntry = useCollaborationSession(projectId,receiver?.id);
  const [peek,setPeek] = useState<string>();
  const [manage,setManage] = useState(false);
  const [overflowPeek,setOverflowPeek] = useState(false);
  const [query,setQuery] = useState('');
  const [activating,setActivating] = useState<string>();
  const activateLock = useRef(false);
  const [placing, setPlacing] = useState(false);
  const portalPlacement = useRef<AbortController | null>(null);
  useEffect(() => () => { portalPlacement.current?.abort(); portalPlacement.current = null; }, [projectId,canvasId]);
  const placePortal = async (item: RailwayDestinationV1) => {
    if (portalPlacement.current || !canvasId) return;
    const controller = new AbortController(); portalPlacement.current = controller; setPlacing(true); setNotice(undefined);
    const host = useLcosHostStore.getState().host;
    try {
      if (!host || host.projectId !== projectId) throw new Error('当前画布身份尚未确认。');
      const current = () => useLcosShellStore.getState().projectId === projectId && useCanvasStore.getState().canvasId === canvasId
        && useLcosHostStore.getState().host === host;
      const result = await placeExistingWorkspacePortal(projectId,canvasId,item, {
        current, nodes: () => useCanvasStore.getState().nodes,
        bindings: () => host.bindings.list(),
        readTarget: (id, signal) => railway.portalTarget(projectId,id,signal),
        create: (targetCanvasId,label) => {
          const id = createId('node');
          useCanvasStore.getState().addNodes([{id,nodeType:'spacePreview',data:{targetCanvasId,label,origin:{type:'user-created'}}}]);
          return id;
        },
        save: () => useCanvasStore.getState().saveCanvas(),
        claim: (id,nodeId,targetCanvasId) => railway.claimPortal(projectId,id,canvasId,nodeId,targetCanvasId),
      },controller.signal);
      if (current()) {
        useLcosReferenceStore.getState().requestNodeBindingRefresh();
        if (!controller.signal.aborted) {
          useLcosShellStore.getState().requestLocate({reqId:crypto.randomUUID(),surface:useLcosShellStore.getState().activeSurface,
            canvasId,nodeId:result.nodeId,status:'projected',preserveSelection:true});
          setNotice(result.status === 'existing' ? '已定位已有入口，没有重复创建。' : '入口已保存；预览不离开当前现场。');
        }
      }
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : '入口尚未确认，请重试核对同一节点。'); }
    finally { if (portalPlacement.current === controller) portalPlacement.current = null; if (alive.current) setPlacing(false); }
  };
  const alive = useRef(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mutedFocus = useRef<string | undefined>(undefined);
  const drag = useRef<string | undefined>(undefined);
  const [reorderTarget,setReorderTarget] = useState<{readonly key:string;readonly where:'before'|'after'}>();
  const [receiverRefresh,setReceiverRefresh] = useState(0);
  const [elementVersion,setElementVersion] = useState(0);
  const elementCallbacks = useRef(new Map<string,(element:HTMLButtonElement | null)=>void>());
  const elements = useRef(new Map<string,HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const receiverRef = useRef<HTMLButtonElement | null>(null);
  const viewport = useHudViewport();
  const destinations = snapshot?.destinations.filter((d) => d.role !== 'surface') ?? [];
  const receiverDestinationId = receiver?.id;
  const railDestinations = receiverDestinationId
    ? destinations.filter((item) => !(item.ref.kind === 'receiver_conversation' && item.ref.connectedConversationId === receiverDestinationId))
    : destinations;
  const offsets = lcosHudEdgeOffsets(environment,viewport);
  const safeHeight = environment?.safeRect.height ?? Math.max(1, viewport.height - offsets.top - offsets.bottom);
  const dropActive = railwayDropGestureActive(drop.status);
  const reservedHeight = 44 + (receiver ? 36 : 0) + (railDestinations.length ? 36 : 0) + 32;
  const capacity = railwayDynamicCapacity({safeHeight,reservedHeight});
  const primary = railwayVisibleDestinations(railDestinations,capacity,activeWorkspaceId ?? undefined);
  const hidden = railwayHiddenDestinations(railDestinations,primary);
  const receiveOverflowOpen = dropActive && hidden.length > 0;
  useEffect(() => {
    if (!dropActive) return;
    setManage(false);
    setQuery('');
    setPeek(undefined);
    setOverflowPeek(false);
  },[dropActive]);
  const focused = destinations.find((d) => d.key === peek);
  const primaryHeight = primary.length ? 10 + primary.length * 42 : 0;
  const hostHeight = Math.max(52,primaryHeight) + (hidden.length ? 36 : 0) + (receiver ? 36 : 0) + 44;
  const placement = useAvoidingHudPosition({x:offsets.left,y:lcosHudSafeCenterY(environment,viewport.height),width:52,height:hostHeight},{y:'center'});
  const cancelHide = useCallback(() => { if (hideTimer.current) clearTimeout(hideTimer.current); },[]);
  const dismiss = useCallback((restore = false) => {
    cancelHide(); setManage(false); setPeek(undefined);
    if (restore) { mutedFocus.current = peek; (peek ? elements.current.get(`rail:${peek}`) : addRef.current)?.focus(); }
  },[cancelHide,peek]);
  const enterPeek = (key: string) => {
    if (mutedFocus.current === key) { mutedFocus.current = undefined; return; }
    if (manage || drag.current) return;
    cancelHide(); setPeek(key);
  };
  const leavePeek = () => {
    cancelHide(); hideTimer.current = setTimeout(() => {
      if (!panelRef.current?.contains(document.activeElement)) setPeek(undefined);
    },180);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelHide(); }; },[cancelHide]);
  const refresh = useCallback(() => { void reload(); setReceiverRefresh((n) => n+1); },[reload]);
  useEffect(() => watch(projectId,refresh),[watch,projectId,refresh]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const cancelDrag = () => { drag.current=undefined; setReorderTarget(undefined); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelDrag(); };
    window.addEventListener('focus',refresh); window.addEventListener('blur',cancelDrag); window.addEventListener('keydown',key);
    document.addEventListener('visibilitychange',visible);
    return () => { window.removeEventListener('focus',refresh);window.removeEventListener('blur',cancelDrag);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visible); };
  },[refresh]);
  useEffect(() => {
    const controller = new AbortController(); let current=true;
    void Promise.all([conversations.listConnectedConversations(projectId,controller.signal),conversations.getReceiverBinding(projectId,controller.signal)])
      .then(([list,binding]) => { if (!current) return; setReceiver(list.find((c) => c.id === binding.activeReceiverId));setReceiverError(undefined); })
      .catch(() => { if (current) {setReceiver(undefined);setReceiverError('承接会话读取失败');} });
    return () => {current=false;controller.abort();};
  },[conversations,projectId,receiverRefresh]);
  // One element may occur in the island and in management. Each live receptor has its own target ID.
  const onElement = useCallback((key: string,element: HTMLButtonElement | null) => {
    if (elements.current.get(key) === element || (!element && !elements.current.has(key))) return;
    if (element) elements.current.set(key,element); else elements.current.delete(key);
    setElementVersion((n) => n+1);
  },[]);
  const elementRef = (key: string) => {
    let callback=elementCallbacks.current.get(key);
    if (!callback) { callback=(element)=>onElement(key,element);elementCallbacks.current.set(key,callback); }
    return callback;
  };
  useEffect(() => {
    const store = useLcosDropStore.getState();
    const cleanups: (() => void)[]=[];
    for (const [elementKey,element] of elements.current) {
      const key = elementKey.slice(elementKey.indexOf(':')+1);
      const destination = snapshot?.destinations.find((d) => d.key === key);
      if (!destination) continue;
      const enabled = status === 'ready' && !busy && destination.available && destination.accepts.length > 0 && destination.canvasId !== canvasId;
      const reason = destination.reason ?? (destination.role === 'receiver' ? '这里只打开会话；请把材料拖到画布上的会话本体。'
        : destination.canvasId === canvasId ? '已经在当前现场，请直接在画布整理。' : '目的地暂不能接收材料。');
      cleanups.push(store.registerTarget({targetId:targetId(projectId,elementKey),kind:enabled ? 'railway-receive' : 'drop-exclusion',label:destination.label,
        rect:rectFromDomRect(element.getBoundingClientRect()),readRect:() => element.isConnected ? rectFromDomRect(element.getBoundingClientRect()) : undefined,
        acceptsPoint:(point) => isDropPointExposed(element,point),priority:30,enabled:true,
        semantic:enabled && destination.ref.kind === 'worksite' && destination.workspaceId ? {
          kind:'railway-receive',targetRef:{kind:'workspace',id:destination.workspaceId},destinationRef:destination.ref,
          canvasId:destination.canvasId,orderVersion:snapshot!.order.version,accepts:destination.accepts,
        } : {kind:'drop-exclusion',reason}}));
    }
    for (const [id,element] of [['panel',panelRef.current],['receiver',receiverRef.current]] as const) {
      if (!element) continue;
      cleanups.push(store.registerTarget({targetId:`railway-control:${projectId}:${id}`,kind:'drop-exclusion',label:'导航操作',
        rect:rectFromDomRect(element.getBoundingClientRect()),readRect:()=>element.isConnected ? rectFromDomRect(element.getBoundingClientRect()) : undefined,
        acceptsPoint:(point)=>isDropPointExposed(element,point),priority:5,enabled:true,
        semantic:{kind:'drop-exclusion',reason:'请放到明确的现场目的地上；这里不会投到背景画布。'}}));
    }
    return () => { for (const close of cleanups) close(); };
  },[snapshot,status,busy,canvasId,elementVersion,projectId,manage,peek,receiver]);

  const activate = async (item: RailwayDestinationV1) => {
    if (!item.available || activateLock.current || busy || status !== 'ready') return;
    activateLock.current=true;setActivating(item.key);setNotice(undefined);
    try {
      const fresh = await railway.snapshot(projectId);
      if (!alive.current) return;
      const target = fresh.destinations.find((d) => d.key === item.key);
      if (!target?.available) throw new Error(target?.reason ?? '目的地已被移出导航。');
      if (target.canvasId !== item.canvasId) { void reload(); throw new Error('目标画布已变化，请重新预览后进入。'); }
      if (target.ref.kind === 'receiver_conversation') openWindow('conversation',`会话窗口 · ${target.label}`,target.ref.connectedConversationId);
      else if (target.workspaceId !== activeWorkspaceId) await activateDestination(target);
      if (alive.current) dismiss();
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : '进入失败，仍保留当前现场。'); }
    finally {activateLock.current=false;if(alive.current)setActivating(undefined);}
  };
  const remove = (key: string) => update((s) => s.order.orderedRefs.filter((ref) => railwayStableKeyV1(ref)!==key),'已移出导航，原现场和内容没有删除。');
  const move = (key: string,target: string,where:'before'|'after') => update((s) => moveRailwayDestination(s.order.orderedRefs,key,target,where),'目的地顺序已保存。');
  const dragHandlers = (item: RailwayDestinationV1) => {
    const reorderable = item.role === 'worksite' && item.available && !snapshot?.migrationRequired;
    return ({
    draggable: reorderable && !busy && status === 'ready',
    onDragStart:(event:DragEvent<HTMLButtonElement>) => {
      if (!reorderable || busy || status !== 'ready') {event.preventDefault();return;}
      drag.current=item.key;setPeek(undefined);event.stopPropagation();event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData(REORDER_MIME,JSON.stringify({projectId,key:item.key}));
    },
    onDragOver:(event:DragEvent<HTMLButtonElement>) => {
      if (!drag.current || !Array.from(event.dataTransfer.types).includes(REORDER_MIME) || busy) return;
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';const rect=event.currentTarget.getBoundingClientRect();setReorderTarget({key:item.key,where:event.clientY<rect.top+rect.height/2?'before':'after'});
    },
    onDrop:(event:DragEvent<HTMLButtonElement>) => {
      if (!drag.current || !Array.from(event.dataTransfer.types).includes(REORDER_MIME)) return; // Material Drop belongs to T3.
      event.preventDefault();event.stopPropagation();
      try {
        const payload=JSON.parse(event.dataTransfer.getData(REORDER_MIME)) as {projectId:string;key:string};
        if (payload.projectId!==projectId || payload.key!==drag.current || payload.key===item.key || busy) return;
        const rect=event.currentTarget.getBoundingClientRect();void move(payload.key,item.key,event.clientY<rect.top+rect.height/2?'before':'after');
      } catch { setNotice('排序数据无效，原顺序未改变。'); } finally {drag.current=undefined;setReorderTarget(undefined);}
    },
    onDragEnd:() => {drag.current=undefined;setReorderTarget(undefined);},
  });};
  const receiveState = (item:RailwayDestinationV1,elementKey:string) => railwayReceivePresentation({targetId:targetId(projectId,elementKey),enabled:item.available && item.accepts.length>0 && item.canvasId!==canvasId,dropState:drop,resolution});
  const openManager = () => {cancelHide();setOverflowPeek(false);setPeek(undefined);setManage(true);setQuery('');};
  const items: LcosRailwayViewItem[] = primary.map((item) => ({key:item.key,label:item.label,icon:Eye,
    glyph:item.role==='receiver'?'normal':item.surface==='context'?'context':item.surface==='workflow'?'workflow':'project',
    selected:item.workspaceId===activeWorkspaceId,disabled:!item.available||busy||!!activating||status!=='ready',
    ...dragHandlers(item),reorderDropTarget:reorderTarget?.key===item.key,reorderDropPosition:reorderTarget?.key===item.key?reorderTarget.where:undefined,receivePresentation:receiveState(item,`rail:${item.key}`),
    onElement:elementRef(`rail:${item.key}`),onPeekEnter:()=>enterPeek(item.key),onPeekLeave:leavePeek,onManage:openManager}));
  const row = (item:RailwayDestinationV1,index:number) => <div key={item.key} className="lcos-railway-manage-row" data-railway-row={item.key}>
    <button type="button" className="lcos-railway-row-target" aria-disabled={!item.available||busy||status!=='ready'}
      ref={elementRef(`manager:${item.key}`)} {...dragHandlers(item)} onClick={()=>void activate(item)}
      data-lcos-receive-state={receiveState(item,`manager:${item.key}`)}>
      <FigmaShellGlyph name={item.role==='receiver'?'normal':item.surface==='context'?'context':item.surface==='workflow'?'workflow':'project'} size={20}/>
      <span><strong>{item.label}</strong><small>{item.reason ?? (item.role==='receiver'?'打开原会话，不更改接收者':item.workspaceId===activeWorkspaceId?'当前现场':'进入现场 · 拖入材料可接收')}</small></span>
    </button>
    <div className="lcos-railway-row-actions">
      <button type="button" aria-label={`上移 ${item.label}`} disabled={busy||status!=='ready'||index===0} onClick={()=>{const prev=destinations[index-1];if(prev)void move(item.key,prev.key,'before');}}><ArrowUp size={15}/></button>
      <button type="button" aria-label={`下移 ${item.label}`} disabled={busy||status!=='ready'||index===destinations.length-1} onClick={()=>{const next=destinations[index+1];if(next)void move(item.key,next.key,'after');}}><ArrowDown size={15}/></button>
      <button type="button" aria-label={`移出 ${item.label}`} disabled={busy||status!=='ready'} onClick={()=>void remove(item.key)}><Trash2 size={15}/></button>
    </div>
  </div>;
  const anchor = focused ? elements.current.get(`rail:${focused.key}`)?.getBoundingClientRect() : addRef.current?.getBoundingClientRect();
  const showReceiver=Boolean(receiver);
  const receiverState=receiverEntry?.projection?.userState;
  const receiverLabel=receiverState ? ({ready:'可以继续',thinking:'正在理解',working:'正在执行',needs_user:'等你回应',done:'本轮完成',unavailable:'暂时不可用'}[receiverState]) : '状态读取中';
  const searchable=(snapshot?.candidates ?? []).filter((d)=>d.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div ref={placement.ref} data-lcos-railway data-lcos-railway-version={snapshot?.order.version}
    className="lcos-railway-host" style={{left:placement.rect.x,top:placement.rect.y}}>
    <LcosRailwayView items={items} onSelect={(key)=>{const item=destinations.find((d)=>d.key===key);if(item)void activate(item);}}
      canonicalTotal={destinations.length} overflowCount={hidden.length} overflowOpen={manage||receiveOverflowOpen||overflowPeek} onOverflowToggle={openManager}
      onOverflowEnter={()=>{if(!manage&&!dropActive)setOverflowPeek(true);}} onOverflowLeave={()=>{if(!dropActive)setOverflowPeek(false);}}
      overflow={receiveOverflowOpen||overflowPeek ? <div data-lcos-railway-overflow data-lcos-railway-receive-map={receiveOverflowOpen||undefined} role="dialog" aria-label={receiveOverflowOpen?'更多可接收目的地':'更多现场目的地'}>
        <span data-lcos-railway-overflow-summary>{receiveOverflowOpen?'继续拖动到具体现场；不会打开管理页。':'悬停预览更多目的地；点击直接进入。'}</span>
        <div data-lcos-railway-overflow-list>{hidden.map((item)=><div key={item.key} data-lcos-railway-overflow-row>
          <button type="button" data-lcos-railway-overflow-open ref={elementRef(`overflow:${item.key}`)} disabled={!item.available||busy||status!=='ready'}
            data-lcos-receive-state={receiveState(item,`overflow:${item.key}`)} aria-label={item.label} onClick={()=>void activate(item)}>
            <strong>{item.label}</strong><small>{railwayReceiveLabel(receiveState(item,`overflow:${item.key}`),item.reason)}</small>
          </button>
        </div>)}</div>
      </div> : undefined}
      receiver={showReceiver && receiver ? <div data-lcos-railway-receiver-shell><button type="button" ref={receiverRef} data-lcos-railway-receiver={receiver.id} data-lcos-drop-policy="open-only"
        aria-label={`打开承接会话 ${receiver.label} · ${receiverLabel}`} title={`${receiver.label} · ${receiverLabel}`}
        onClick={()=>openWindow('conversation',`会话窗口 · ${receiver.label}`,receiver.id)}>
        <LcosReceiverIdentity projectId={projectId} conversationId={receiver.id} size={28}/>
      </button></div>:undefined}
      footer={notice||receiverError ? <span role="status">{notice??receiverError}{status==='error'&&<button type="button" onClick={refresh}>重试</button>}</span>:undefined}/>
    <LcosIconButton ref={addRef} appearance="oreo" variant="secondary" shape="circle" size="md" floating data-railway-add
      aria-label="管理现场目的地" title="加入或管理目的地" aria-expanded={manage} onClick={()=>manage?dismiss():openManager()}><Plus size={19}/></LcosIconButton>
    {(manage||focused) && <Popover position={{x:anchor?.right??placement.rect.x+52,y:anchor?.top??placement.rect.y}}
      offset={{x:10,y:0}} style={{...lcosGlassStyle,width:manage?Math.min(360,viewport.width-24):Math.min(300,viewport.width-24),maxHeight:viewport.height-24}}
      className="lcos-railway-popover" contentRef={panelRef} onDismiss={()=>dismiss(true)} zIndex={80}>
      <section role="dialog" aria-label={manage?'管理现场目的地':`${focused?.label} 目的地预览`}
        onMouseEnter={cancelHide} onMouseLeave={manage?undefined:leavePeek} onFocusCapture={cancelHide}>
        <header><strong>{manage?'现场目的地':focused?.label}</strong><button type="button" aria-label="关闭目的地面板" onClick={()=>dismiss(true)}><X size={17}/></button></header>
        {manage ? <>
          {status==='loading' && !snapshot && <p role="status">正在读取目的地…</p>}
          {snapshot?.migrationRequired && <div className="lcos-railway-migration"><p>旧导航已按原身份列出，未识别的记录保留。确认后使用新版顺序。</p>
            <button type="button" disabled={busy||status!=='ready'} onClick={()=>void update((s)=>s.order.orderedRefs,'旧记录已保留并更新，未创建任何现场。')}>保留记录并更新</button></div>}
          <div className="lcos-railway-manage-list" aria-label="已加入的目的地">{destinations.length?destinations.map(row):<p>还没有加入目的地。下方只列出现有现场与已确认会话。</p>}</div>
          {snapshot?.destinations.some(d=>d.role==='surface') && <details><summary>旧一级入口</summary>{snapshot.destinations.filter(d=>d.role==='surface').map(d=><div className="lcos-railway-legacy-root" key={d.key}><span>{d.label}（由底部入口接管）</span><button type="button" disabled={busy||status!=='ready'} onClick={()=>void remove(d.key)}>移出导航</button></div>)}</details>}
          <label className="lcos-railway-candidate-search"><span>加入目的地</span><input type="search" autoFocus aria-label="搜索可加入目的地" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索现有现场或会话"/></label>
          <div className="lcos-railway-candidates">{searchable.map(item=><button type="button" key={item.key} disabled={!item.available||busy||status!=='ready'||snapshot?.migrationRequired}
            aria-label={`加入 ${item.label}`} title={item.reason} onClick={()=>void update(s=>[...s.order.orderedRefs,item.ref],'目的地已加入。')}>
            <span><strong>{item.label}</strong>{item.reason&&<small>{item.reason}</small>}</span><Plus size={16}/>
          </button>)}{status==='ready'&&!searchable.length&&<p>{query.trim()?'没有匹配的现有目的地。':'没有更多可加入的目的地；这里不会自动创建现场。'}</p>}</div>
        </> : focused && <>
          {focused.canvasId&&focused.available ? <RailwayPeek canvasId={focused.canvasId}/> : <p>{focused.reason??'这是原会话入口；内容在会话窗口中读取。'}</p>}
          <p>{focused.role==='receiver'?'这里只打开原会话，不更改当前接收者。':railwayReceiveLabel(receiveState(focused,`rail:${focused.key}`),focused.reason)}</p>
          <div className="lcos-railway-peek-actions"><button type="button" disabled={!focused.available||busy||!!activating||status!=='ready'} onClick={()=>void activate(focused)}><Eye size={15}/>打开</button>
            {focused.ref.kind === 'worksite' && focused.canvasId !== canvasId && <button type="button" disabled={placing||busy||!!activating||!focused.available||status!=='ready'} onClick={()=>void placePortal(focused)}><Plus size={15}/>{placing ? '保存入口…' : '放置入口'}</button>}
            <button type="button" onClick={openManager}><MoreHorizontal size={15}/>管理</button></div>
        </>}
        {notice&&<p role="status">{notice}</p>}{status==='error'&&<button type="button" onClick={refresh}>重新读取目的地</button>}
      </section>
    </Popover>}
  </div>;
}
