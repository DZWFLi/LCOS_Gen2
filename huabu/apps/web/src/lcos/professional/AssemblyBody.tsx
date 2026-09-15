// AssemblyBody — 项目共享仓库（Figma Assembly/瀑布流；真实 Core warehouse read model）。
// 内容优先：瀑布流卡片 + 搜索/类型筛选；动作：阅读（Reader）、加入 Composer 草稿、
// 投放 Main（统一 apply 通道，逐项回执 partial 如实展示）。
// Assembly 不拥有第二 Project truth——只读 warehouse + 既有 apply。


import {
  CoreAssemblyClient,
} from '@local-creative-os/web-gen2';
import { BookOpen, FileAudio, FileImage, FileText, FolderOpen, MessageCircle, PlusCircle, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DropdownMenu, DropdownMenuItem, DropdownMenuSubmenu } from '@/components/Common/DropdownMenu';
import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { childSurfaceForItem, workspaceTargetsForItem } from '../navigation/workspaceTargets';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

import type {
  AssemblyApplyResultV1,
  AssemblySourceRefV1,
  AssemblyTargetRefV1,
  WarehouseItemV1,
  WarehouseEntityKindV1,
} from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

const KIND_LABEL: Readonly<Record<WarehouseEntityKindV1, string>> = {
  artifact: '材料',
  note: '便签',
  conversation: '会话',
  resource: '资源',
  context: '上下文',
  workflow: '工作流',
  scene: '现场',
  collection: '集合',
};

const FAMILY_LABEL: Readonly<Record<NonNullable<WarehouseItemV1['visualFamily']>, string>> = {
  image: '图像',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  ppt: '演示文稿',
  markdown: '文本',
  link: '链接',
  archive: '压缩包',
  file: '文件',
};

function materialFamily(item: WarehouseItemV1): string {
  return item.visualFamily === undefined ? KIND_LABEL[item.kind] ?? item.kind : FAMILY_LABEL[item.visualFamily];
}

function MaterialGlyph({ item }: { readonly item: WarehouseItemV1 }): React.JSX.Element {
  if (item.visualFamily === 'image') return <FileImage className="h-5 w-5" aria-hidden />;
  if (item.visualFamily === 'audio' || item.visualFamily === 'video') return <FileAudio className="h-5 w-5" aria-hidden />;
  if (item.kind === 'collection' || item.kind === 'scene' || item.kind === 'workflow' || item.kind === 'context') return <FolderOpen className="h-5 w-5" aria-hidden />;
  return <FileText className="h-5 w-5" aria-hidden />;
}

/** Assembly 的对象入口：会话保留会话工作视图，其余实体进入 Reader。 */
export type AssemblyOpenTarget =
  | { readonly bodyKey: 'reader' | 'conversation' | 'portal-preview'; readonly target: string; readonly label: string; readonly targetKind?: 'canvas' }
  | { readonly bodyKey: 'unavailable'; readonly label: string };

/** 只返回已有 body 能正确消费的 target；不把 scope/resource id 冒充 artifactId。 */
export function assemblyOpenTargetOf(item: WarehouseItemV1, workspaces: readonly Pick<Workspace, 'id' | 'canvasId'>[] = []): AssemblyOpenTarget {
  switch (item.kind) {
    case 'artifact':
      return { bodyKey: 'reader', target: item.entityRef.id, label: '阅读' };
    case 'conversation':
      return { bodyKey: 'conversation', target: item.entityRef.id, label: '打开会话' };
    case 'context':
    case 'workflow':
      return { bodyKey: 'unavailable', label: '尚未关联可打开的现场' };
    case 'scene': {
      const workspace = workspaces.find((candidate) => String(candidate.id) === item.entityRef.id);
      return workspace?.canvasId
        ? { bodyKey: 'portal-preview', target: workspace.canvasId, targetKind: 'canvas', label: '预览现场' }
        : { bodyKey: 'unavailable', label: '现场画布尚未就绪' };
    }
    case 'collection':
    case 'note':
    case 'resource':
      return { bodyKey: 'unavailable', label: '暂不可打开' };
  }
}

export function assemblyWindowOf(item: WarehouseItemV1): AssemblyOpenTarget['bodyKey'] {
  return assemblyOpenTargetOf(item).bodyKey;
}

/** previewRef 目前无 Core producer；仅接受可直接作为 img src 的 URL，拒绝 opaque id。 */
export function previewUrlOf(item: WarehouseItemV1): string | undefined {
  const value = item.previewRef?.trim();
  if (value === undefined || value === '') return undefined;
  return /^(?:https?:\/\/|blob:|data:image\/)/i.test(value) ? value : undefined;
}

export function assemblySourceRefOf(item: WarehouseItemV1): AssemblySourceRefV1 {
  switch (item.kind) {
    case 'artifact':
      return {
        kind: 'artifactView',
        id: item.entityRef.viewId ?? item.entityRef.id,
      };
    case 'note':
    case 'resource':
    case 'conversation':
    case 'context':
    case 'workflow':
    case 'scene':
    case 'collection':
      return { kind: item.kind, id: item.entityRef.id };
  }
}

function targetLabel(target: AssemblyTargetRefV1): string {
  switch (target.kind) {
    case 'main':
      return 'Main';
    case 'conversation':
      return '当前会话';
    case 'context':
      return '当前 Context';
    case 'workflow':
      return '当前 Workflow';
    case 'workspace':
    case 'scene':
      return '当前工作现场';
    case 'project':
      return '当前项目';
  }
}

export function AssemblyBody({
  projectId,
  targetRef,
}: {
  readonly projectId: string;
  readonly targetRef: AssemblyTargetRefV1;
}): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const navigate = useNavigate();
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const beginChildNavigation = useLcosShellStore((s) => s.beginChildNavigation);
  const openWindow = useLcosShellStore((s) => s.openWindow);

  const [items, setItems] = useState<readonly WarehouseItemV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [applyResult, setApplyResult] = useState<AssemblyApplyResultV1 | null>(null);
  const [applying, setApplying] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [workspaceError, setWorkspaceError] = useState(false);
  const loadGeneration = useRef(0);

  const load = (): void => {
    const generation = ++loadGeneration.current;
    setState('loading');
    setWorkspaces([]);
    setWorkspaceError(false);
    void Promise.allSettled([assembly.getWarehouse(projectId), session.projects.getWorkspaces(projectId)])
      .then(([warehouse, sites]) => {
        if (generation !== loadGeneration.current) return;
        if (warehouse.status === 'rejected') {
          setState('error');
          setErrorDetail(warehouse.reason instanceof Error ? warehouse.reason.message : String(warehouse.reason));
          return;
        }
        setItems(warehouse.value.items);
        if (sites.status === 'fulfilled') setWorkspaces(sites.value);
        else setWorkspaceError(true);
        setState('ready');
      });
  };

  useEffect(() => {
    load();
    return () => { loadGeneration.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((item) => (item.title ?? '').toLowerCase().includes(q));
  }, [items, query]);

  const refOf = (item: WarehouseItemV1): {
    entityType: string;
    entityId: string;
    displayLabel?: string;
  } => ({
    entityType: item.kind,
    entityId: item.entityRef.id,
    ...(item.title === undefined ? {} : { displayLabel: item.title }),
  });

  const addToComposer = (item: WarehouseItemV1): void => {
    // 加入统一 Composer 草稿（reference store draft；Selection≠Reference）
    useLcosReferenceStore.getState().addEntityToDraft(refOf(item));
  };

  const dropToTarget = (item: WarehouseItemV1): void => {
    setApplying(true);
    setApplyResult(null);
    void assembly
      .apply(projectId, {
        schemaVersion: 1,
        projectId,
        sourceRefs: [assemblySourceRefOf(item)],
        targetRef,
      })
      .then((result) => setApplyResult(result))
      .catch((error: unknown) => {
        setApplyResult({
          schemaVersion: 1,
          projectId,
          results: [{ sourceRef: { kind: 'artifactView', id: item.entityRef.id }, status: 'failed', channel: 'error', message: error instanceof Error ? error.message : String(error) }],
          allApplied: false,
        });
      })
      .finally(() => setApplying(false));
  };

  const enterChildWorkspace = (item: WarehouseItemV1, workspace: Workspace): void => {
    if (workspace.canvasId === undefined) return;
    const targetSurface = childSurfaceForItem(item, workspace);
    if (targetSurface === undefined) return;
    const current = useCanvasStore.getState();
    beginChildNavigation({
      projectId,
      sourceSurface: activeSurface,
      ...(activeWorkspaceId === null ? {} : { sourceWorkspaceId: activeWorkspaceId }),
      sourceWasChild: new URLSearchParams(window.location.search).has('workspaceId'),
      ...(current.canvasId === null ? {} : { sourceCanvasId: current.canvasId }),
      selectedNodeIds: current.nodes.filter((node) => node.selected).map((node) => node.id),
    });
    navigate(`/projects/${encodeURIComponent(projectId)}/${targetSurface}?workspaceId=${encodeURIComponent(String(workspace.id))}`);
  };

  return (
    <div
      data-lcos-assembly
      data-lcos-assembly-target={targetRef.kind}
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.raised }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索仓库（当前页过滤）"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: lcosTokens.color.text }}
          />
        </label>
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          {items.length} 项 · 投放到{targetLabel(targetRef)}
        </span>
      </div>

      {state === 'loading' && (
        <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取项目仓库…" /></div>
      )}
      {state === 'ready' && workspaceError && (
        <div className="flex items-center gap-2 py-2 text-xs" style={{ color: lcosTokens.color.muted }}>
          <span>现场信息读取失败，材料仍可使用。</span>
          <button type="button" onClick={load} className="min-h-11 rounded-full px-3">重试读取现场</button>
        </div>
      )}
      {state === 'error' && (
        <div className="py-10">
          <LcosSurfaceFeedback presentation="error" message={`仓库读取失败${errorDetail ? `（${errorDetail}）` : ''}`} onAction={load} />
        </div>
      )}
      {state === 'ready' && filtered.length === 0 && (
        <div className="py-10"><LcosSurfaceFeedback presentation="empty" message="仓库还没有内容" /></div>
      )}

      {state === 'ready' && filtered.length > 0 && (
        <div className="max-h-[52vh] overflow-y-auto pr-1">
          <div className="columns-1 gap-4 sm:columns-2" data-lcos-assembly-waterfall>
          {filtered.map((item) => {
            const previewUrl = previewUrlOf(item);
            return (
            <div
              key={`${item.kind}:${item.entityRef.id}`}
              data-lcos-assembly-item={item.entityRef.id}
              data-lcos-assembly-item-kind={item.kind}
              data-lcos-assembly-visual-family={item.visualFamily ?? item.kind}
              className="group mb-4 flex break-inside-avoid flex-col gap-2 rounded-2xl p-3 transition-shadow hover:shadow-md focus-within:shadow-md"
              onMouseEnter={() => setActiveItemId(item.entityRef.id)}
              onMouseLeave={() => setActiveItemId((current) => current === item.entityRef.id ? null : current)}
              style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}`, boxShadow: lcosTokens.shadow.default }}
            >
              <div
                className={`${previewUrl ? 'min-h-24' : 'px-3 py-2'} flex items-center justify-center rounded-xl`}
                data-lcos-assembly-material
                style={{ background: previewUrl ? lcosTokens.color.raised : 'transparent', color: lcosTokens.color.muted }}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="" className="max-h-56 w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-xs">
                    <MaterialGlyph item={item} />
                    <span>{materialFamily(item)}</span>
                    <span className="text-[10px] opacity-70">暂无真实预览</span>
                  </div>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-sm font-medium" style={{ color: lcosTokens.color.text }}>
                  {item.title ?? '未命名'}
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
                  style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}
                  data-lcos-assembly-kind={item.kind}
                >
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                {item.visualFamily ? <span>{item.visualFamily}</span> : null}
                {item.usageCount > 0 ? <span>· 使用 {item.usageCount}</span> : null}
                {item.provenance ? <span>· {item.provenance.origin}</span> : null}
              </div>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                {item.updatedAt ? <span>{new Date(item.updatedAt).toLocaleDateString()}</span> : null}
                {item.usedHere ? <span>· 已在此处</span> : null}
              </div>
              <button
                type="button"
                data-lcos-assembly-more
                aria-expanded={activeItemId === item.entityRef.id}
                onClick={() => setActiveItemId((current) => current === item.entityRef.id ? null : item.entityRef.id)}
                className="self-start rounded-full px-2 py-1 text-xs"
                style={{ color: lcosTokens.color.info }}
              >
                取用
              </button>
              <div data-lcos-assembly-actions className={`${activeItemId === item.entityRef.id ? 'flex' : 'hidden'} items-center gap-1 group-focus-within:flex`}>
                <button type="button" onClick={() => addToComposer(item)} title="加入 Composer 草稿" data-lcos-assembly-add className="flex items-center gap-1 rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.text }} >
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden /> 草稿
                </button>
                {(() => {
                  if (item.kind === 'context' || item.kind === 'workflow' || item.kind === 'collection') {
                    const targets = workspaceTargetsForItem(item, workspaces);
                    if (targets.length > 0) {
                      return (
                        <DropdownMenu trigger={
                          <button type="button" className="min-h-11 rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.info }}>选择现场预览</button>
                        }>
                          {targets.map((workspace) => (
                            <DropdownMenuSubmenu key={String(workspace.id)} label={`${workspace.name}${workspace.canvasId ? '' : ' · 画布尚未就绪'}`}>
                              <DropdownMenuItem disabled={!workspace.canvasId}
                                title={workspace.canvasId ? `预览 ${workspace.name}` : '现场画布尚未就绪'}
                                onClick={() => { if (workspace.canvasId) openWindow('portal-preview', `预览现场 · ${workspace.name}`, workspace.canvasId, 'canvas'); }}>
                                预览现场
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!workspace.canvasId}
                                title={workspace.canvasId ? `进入 ${workspace.name}` : '现场画布尚未就绪'}
                                onClick={() => enterChildWorkspace(item, workspace)}>
                                进入现场
                              </DropdownMenuItem>
                            </DropdownMenuSubmenu>
                          ))}
                        </DropdownMenu>
                      );
                    }
                  }
                  const openTarget = assemblyOpenTargetOf(item, workspaces);
                  if (openTarget.bodyKey === 'unavailable') {
                    return <span data-lcos-assembly-unavailable className="rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.muted }}>{workspaceError && (item.kind === 'scene' || item.kind === 'context' || item.kind === 'workflow' || item.kind === 'collection') ? '现场信息读取失败，请重试' : openTarget.label}</span>;
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => openWindow(openTarget.bodyKey, `${openTarget.label} · ${item.title ?? '材料'}`, openTarget.target, openTarget.targetKind)}
                      title={openTarget.label}
                      className="flex items-center gap-1 rounded-full px-2 py-1 text-xs"
                      style={{ color: lcosTokens.color.info }}
                    >
                      {openTarget.bodyKey === 'conversation' ? <MessageCircle className="h-3.5 w-3.5" aria-hidden /> : <BookOpen className="h-3.5 w-3.5" aria-hidden />} {openTarget.label}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => dropToTarget(item)}
                  title={`投放到${targetLabel(targetRef)}（真实 apply 回执）`}
                  data-lcos-assembly-drop
                  className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                  style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 32 }}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden /> 投放
                </button>
              </div>
            </div>
            );
          })}
          </div>
        </div>
      )}

      <style>{`@media (hover: none), (pointer: coarse) { [data-lcos-assembly-actions] { display: flex; } }`}</style>

      {applyResult && (
        <div data-lcos-assembly-receipt className="rounded-xl px-3 py-2" style={{ background: applyResult.allApplied ? 'rgba(84,116,100,0.08)' : 'rgba(194,91,78,0.08)', color: applyResult.allApplied ? lcosTokens.color.accent : lcosTokens.color.danger }}>
          {applyResult.results.map((r) => (
            <div key={`${r.sourceRef.kind}:${r.sourceRef.id}`} className="flex items-center justify-between gap-2 py-0.5 text-xs">
              <span>
                {r.status === 'applied' ? '已投放' : r.status === 'skipped' ? '跳过' : '失败'}
                {r.message ? ` · ${r.message}` : ''}
              </span>
              {r.changeSetId && <span className="shrink-0 text-[10px] opacity-70">已记录变更 {r.changeSetId.slice(0, 8)}</span>}
            </div>
          ))}
          {applyResult.allApplied ? '全部成功' : '部分失败 · 未成功的材料保留在仓库中'}
        </div>
      )}
    </div>
  );
}
