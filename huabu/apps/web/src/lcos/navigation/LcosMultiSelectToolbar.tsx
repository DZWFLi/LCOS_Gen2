import { alignNodes, spreadNodes, type AlignDirection } from '@huabu/shared/canvas-engine';
import { withCollectionGeometryCompanions } from '../nodes/collectionDragCompanions';
import { FolderPlus, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultiSelectToolbar } from '@/components/Panels/Canvas/FloatingToolbars/MultiSelectToolbar';
import { deletableCanvasNodeIds } from '@/hooks/shortcuts/deleteSelection';
import { createLcosCoreSession } from '@/lcos/app/lcosCoreClient';
import useCanvasStore from '@/store/canvasStore';
import { toast } from '@/components/Common/Toast';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { waitForProjectedEntity } from './waitForProjectedEntity';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosIconButton } from '../ui/primitives/LcosIconButton';
import { prepareDraftReferences } from '../composer/referenceSnapshot';
import { snapshotCanvasDropNodes, sameCanvasDropNode } from '../drop/nativeCanvasDropGeometry';
import { collectionHostMemberIds } from '../nodes/collectionHost';
import { planSelectionLayout, layoutNodeLocked, selectionVisibleBounds } from './selectionLayout';
import type { SelectionLayoutAction } from './selectionLayout';
import type { CoreCollectionMemberRef } from '@local-creative-os/web-gen2';
import type { CanvasNodeId } from '@huabu/shared';

const MEMBER_TYPES = new Set(['artifact','note','collection','scope','workspace','conversation','run']);

/** Shared native selection is the only target set. UI actions capture that set
 * once; asynchronous creation may not retarget a later selection or camera. */
export function LcosMultiSelectToolbar(): React.JSX.Element {
  const nodes = useCanvasStore((state) => state.nodes);
  const canvasId = useCanvasStore((state) => state.canvasId);
  const projectId = useLcosShellStore((state) => state.projectId);
  const refs = useLcosReferenceStore((state) => state.nodeEntityRefs);
  const picking = useLcosReferenceStore((state) => state.referencePickOwner !== null);
  const ready = useLcosReferenceStore((state) => state.bindingIdentitiesReady
    && state.projectId === projectId && state.bindingCanvasId === canvasId);
  const selected = useMemo(() => nodes.filter((node) => node.selected).map((node) => node.id), [nodes]);
  const selectedKey = JSON.stringify(selected);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [contextRequest, setContextRequest] = useState(0);
  useEffect(() => {
    if (selected.length < 2) return;
    const context = (event: MouseEvent) => {
      const element = event.target as Element | null;
      if (!element?.closest || element.closest('input,textarea,select,[contenteditable="true"]')) return;
      const id = element.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset.id;
      if (!id || !selected.includes(id)) return;
      event.preventDefault(); setContextRequest((value) => value + 1);
    };
    window.addEventListener('contextmenu', context);
    return () => window.removeEventListener('contextmenu', context);
  }, [selectedKey]);
  const protectedSelection = deletableCanvasNodeIds(nodes, refs, selected).length !== selected.length;
  const loading = !ready ? '正在确认所选材料，请稍后再试' : undefined;
  const deleteReason = loading ?? (protectedSelection ? '所选含项目材料，不能只删除其中的画布外壳；请使用内容管理中的移除操作' : undefined);
  const moveReason = loading ?? (protectedSelection ? '这组项目材料暂不支持物理跨现场搬移' : undefined);
  const bound = selected.map((id) => refs.get(id));
  const members = [...new Map(bound.flatMap((ref) => ref && MEMBER_TYPES.has(ref.entityType)
    ? [[JSON.stringify([ref.entityType,ref.entityId]), {type:ref.entityType as CoreCollectionMemberRef['type'],id:ref.entityId}] as const] : [])).values()];
  const canCollect = ready && selected.length >= 2 && bound.every((ref) => !!ref && MEMBER_TYPES.has(ref.entityType));
  const workRefs = prepareDraftReferences(bound, 'delegate');
  const runLayout = (action: SelectionLayoutAction) => {
    const current = useCanvasStore.getState(); const ids=current.nodes.filter((node) => node.selected).map((node) => node.id);
    const items=withCollectionGeometryCompanions(current.nodes, planSelectionLayout(current.nodes, ids, action, new Map([...useLcosReferenceStore.getState().nodeEntityRefs].map(([id, ref]) => [id, ref.entityType]))));
    if (!items.length) { toast('当前位置无需调整，或固定对象限制了这次排布。'); return; }
    current.beginGesture('SET_NODE_GEOMETRY'); current.setNodeGeometry(items);
  };
  const align = (direction?: AlignDirection) => {
    const current = useCanvasStore.getState();
    const ids = selectionVisibleBounds(current.nodes, current.nodes.filter((node) => node.selected).map((node) => node.id))
      .filter((item) => !layoutNodeLocked(current.nodes, item.node.id)).map((item) => item.node.id);
    if (ids.length < 2) return;
    const result = direction ? alignNodes(current.nodes, direction, ids) : spreadNodes(current.nodes, 24, ids);
    if (!result) return;
    const before = new Map(current.nodes.map((node) => [node.id,node]));
    const items = withCollectionGeometryCompanions(current.nodes, result.flatMap((node) => {
      const old = before.get(node.id);
      return old && (old.position.x !== node.position.x || old.position.y !== node.position.y)
        ? [{nodeId:node.id as CanvasNodeId,position:node.position}] : [];
    }));
    if (items.length) { current.beginGesture('SET_NODE_GEOMETRY'); current.setNodeGeometry(items); }
  };
  const startWork = () => {
    const shell=useLcosShellStore.getState(); if (!ready || !workRefs.ok || projectId !== shell.projectId) return;
    const boxes=selectionVisibleBounds(nodes,selected); if (!boxes.length) return;
    const x=Math.min(...boxes.map((item)=>item.x)),y=Math.min(...boxes.map((item)=>item.y));
    const width=Math.max(...boxes.map((item)=>item.x+item.width))-x,height=Math.max(...boxes.map((item)=>item.y+item.height))-y;
    shell.openComposer({nodeId:selected[0]!,targetNodeIds:[...selected],targetReferences:workRefs.references,
      title:`${selected.length} 个所选对象`,anchor:{x,y,width,height},intent:'delegate',
      ...(shell.activeWorkspaceId ? {workspaceId:shell.activeWorkspaceId} : {})});
  };
  const collect = useCallback(async () => {
    if (pending.current || !projectId || !canvasId || !canCollect) return;
    pending.current=true; setBusy(true);
    const originSurface=useLcosShellStore.getState().activeSurface;
    const shapes=selectionVisibleBounds(nodes,selected);
    const hostIds=collectionHostMemberIds(nodes,selected,'');
    const originals=snapshotCanvasDropNodes([...new Set([...selected,...hostIds])],nodes,refs);
    try {
      const client=createLcosCoreSession().collections;
      const {collection}=await client.createFromMembers(projectId,'新内容集合',members);
      const sameSite=()=>useLcosShellStore.getState().projectId===projectId
        && useLcosShellStore.getState().activeSurface===originSurface && useCanvasStore.getState().canvasId===canvasId;
      if (!sameSite()) return;
      useLcosReferenceStore.getState().requestNodeBindingRefresh();
      const nodeId=await waitForProjectedEntity({projectId,canvasId,entityType:'collection',entityId:collection.id,timeoutMs:8000});
      if (!nodeId || !sameSite()) { toast('集合已保存；内容保持原位，等待当前画布更新。'); return; }
      const current=useCanvasStore.getState();
      const liveRefs=useLcosReferenceStore.getState().nodeEntityRefs;
      const live=snapshotCanvasDropNodes([...new Set([...selected,...hostIds])],current.nodes,liveRefs);
      const unchanged=originals.length===new Set([...selected,...hostIds]).size && originals.every((original)=>sameCanvasDropNode(original,live.find((item)=>item.nodeId===original.nodeId)))
        && current.nodes.filter((node)=>node.selected).map((node)=>node.id).join('\0')===selected.join('\0')
        && selected.every((id)=>{const node=current.nodes.find((item)=>item.id===id);return node && !node.dragging && !node.data?.locked;});
      if (!unchanged) { toast('集合已保存；你已继续操作，未改变当前选择和位置。'); return; }
      const right=Math.max(...shapes.map((item)=>item.x+item.width)); const top=Math.min(...shapes.map((item)=>item.y));
      current.frameSelectedNodes({nodeIds:hostIds,label:collection.title,collectionId:collection.id,collectionNodeId:nodeId,
        emptyBounds:{x:right+292,y:top,width:320,height:220},
        geometryUpdates:[{nodeId:nodeId as CanvasNodeId,position:{x:right+72,y:top}}]});
      const final=useCanvasStore.getState(); const frame=final.nodes.find((node)=>node.type==='frame' && node.data?.lcosCollectionId===collection.id);
      if (frame && !final.collapsedFrameIds.has(frame.id)) final.toggleFrameCollapse(frame.id);
      toast(hostIds.length>=selected.length ? '已收成集合，点本体展开。' : '已收成集合；已有其它位置的内容继续保留在原处。');
    } catch (error) {
      toast(error instanceof Error ? error.message : '集合结果尚未确认；源材料保留，请先核对已有集合。', {tone:'danger'});
    } finally { pending.current=false; if(alive.current) setBusy(false); }
  }, [canCollect,projectId,canvasId,selectedKey,nodes,refs,members]);
  const selectionAction=projectId ? <div className="lcos-selection-primary" data-lcos-selection-actions>
    <span aria-label={`已选 ${selected.length} 项`}>{selected.length} 项</span>
    <LcosIconButton appearance="oreo" variant="secondary" size="sm" disabled={!canCollect || busy}
      aria-label="收成集合" title={loading ?? (canCollect ? '直接收成集合，名称可稍后修改' : '所选内容尚未全部保存为项目材料')}
      onClick={()=>{void collect();}}><FolderPlus size={16} aria-hidden/></LcosIconButton>
    <LcosIconButton appearance="oreo" variant="secondary" size="sm" disabled={!ready || !workRefs.ok || busy}
      aria-label="对所选对象开始 AI 工作" title={workRefs.ok ? '对这组对象工作；额外引用保持独立' : workRefs.reason}
      onClick={startWork}><Sparkles size={16} aria-hidden/></LcosIconButton>
  </div> : null;
  return <MultiSelectToolbar presentation="lcos" selectionAction={selectionAction}
    contextMenuRequest={contextRequest} suppressed={picking || nodes.some((node)=>node.dragging || node.resizing)}
    onAlign={align} onSpread={()=>align()} onTidy={()=>runLayout('tidy')}
    onDistribute={selected.length>=3 ? (axis)=>runLayout(axis==='x'?'distribute-x':'distribute-y') : undefined}
    {...(deleteReason===undefined?{}:{deleteDisabledReason:deleteReason})}
    {...(moveReason===undefined?{}:{moveDisabledReason:moveReason})}/>;
}
