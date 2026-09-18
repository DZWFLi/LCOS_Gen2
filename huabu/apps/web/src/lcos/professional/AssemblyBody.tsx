// AssemblyBody — 项目共享仓库 / Source Bay（Figma Assembly 瀑布流；四路 canonical source）。
//
// R4 Assembly（C1-3）：
// - 四路 source 各自独立状态：Project Warehouse / Capture Space / Resources / Skills；
//   一路失败不打死整个 Assembly（controller 内 per-path status/error）。
// - Project Warehouse 走 canonical 分页（nextCursor）+ 服务端搜索（query 变化重置 cursor）+ 去重。
// - Assembly 只做 SourceRef + current typed target → 既有 canonical apply owner
//   （POST /projects/:pid/assembly/apply），逐项回执如实分层；HTTP 200 != 全部成功。
// - drag 只消费 R1 Semantic Drop：AssemblySourceRef → acquireDrop → live target → canonical apply，
//   不改 semanticDropMachine / dwell grammar / target registry。
// Assembly 不拥有第二 Project truth——不复制 membership / relation / Skill binding / Capture truth。

import {
  AssemblySourceBayController,
  assemblyCardViewV1,
  type AssemblySourceTabV1,
} from '@local-creative-os/web-gen2';
import { BookOpen, FileAudio, FileImage, FileText, FolderOpen, MessageCircle, PlusCircle, Search, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import { DropdownMenu, DropdownMenuItem, DropdownMenuSubmenu } from '@/components/Common/DropdownMenu';
import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { acquireDrop } from '../lcosRecognizers';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { childSurfaceForItem, workspaceTargetsForItem } from '../navigation/workspaceTargets';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';
import { assemblySourceRefOf } from './assemblySourceRef';

import type {
  AssemblyApplyItemResultV1,
  AssemblyApplyResultV1,
  AssemblySourceRefV1,
  AssemblyTargetRefV1,
  CaptureStagingItemV0,
  ResourceDescriptorV0,
  SkillCatalogEntryV1,
  WarehouseEntityKindV1,
  WarehouseItemV1,
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

const TAB_LABEL: Readonly<Record<AssemblySourceTabV1, string>> = {
  project: '项目',
  capture: 'Capture',
  sources: '来源',
  skills: 'Skills',
};

const TAB_OWNER_LABEL: Readonly<Record<AssemblySourceTabV1, string>> = {
  project: 'Project Warehouse',
  capture: 'Capture Space（系统级暂存）',
  sources: 'Resources / Sources',
  skills: 'Skills（分层只读）',
};

const EMPTY_TAB_TEXT: Readonly<Record<AssemblySourceTabV1, string>> = {
  project: '仓库还没有内容',
  capture: '暂存区还没有内容',
  sources: '这个项目还没有导入来源',
  skills: '还没有可用技能',
};

const SKILL_SOURCE_LABEL: Readonly<Record<SkillCatalogEntryV1['source'], string>> = {
  system: '系统',
  user: '项目',
  merged: '两层合并',
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

export { assemblySourceRefOf } from './assemblySourceRef';

// ---------------------------------------------------------------------------
// 逐项 apply 回执的诚实分层（R4 §4）：HTTP 200 不等于全部成功。
// ---------------------------------------------------------------------------

export type AssemblyOutcomeToneV1 = 'applied' | 'already-member' | 'unsupported' | 'skipped' | 'failed';

export interface AssemblyOutcomeLineV1 {
  readonly key: string;
  readonly tone: AssemblyOutcomeToneV1;
  readonly label: string;
  readonly detail?: string;
  readonly changeSetId?: string;
}

export interface AssemblyApplySummaryV1 {
  readonly tone: 'applied' | 'partial' | 'failed';
  readonly headline: string;
  readonly lines: readonly AssemblyOutcomeLineV1[];
}

const OUTCOME_LABEL: Readonly<Record<AssemblyOutcomeToneV1, string>> = {
  applied: '已投放',
  'already-member': '已在目标中（跳过）',
  unsupported: '不支持',
  skipped: '跳过',
  failed: '失败',
};

export function assemblyOutcomeToneOf(result: AssemblyApplyItemResultV1): AssemblyOutcomeToneV1 {
  if (result.status === 'failed') return 'failed';
  if (result.status === 'applied') return 'applied';
  if (result.channel === 'already-member') return 'already-member';
  if (result.channel === 'unsupported') return 'unsupported';
  return 'skipped';
}

/** partial 的判定不信任 allApplied：unsupported 也是「没有全部成功」。 */
export function describeAssemblyApplyResultV1(result: AssemblyApplyResultV1): AssemblyApplySummaryV1 {
  const lines: AssemblyOutcomeLineV1[] = result.results.map((item) => {
    const tone = assemblyOutcomeToneOf(item);
    return {
      key: `${item.sourceRef.kind}:${item.sourceRef.id}`,
      tone,
      label: OUTCOME_LABEL[tone],
      ...(item.message === undefined ? {} : { detail: item.message }),
      ...(item.changeSetId === undefined ? {} : { changeSetId: item.changeSetId }),
    };
  });
  const anyFailed = lines.some((line) => line.tone === 'failed');
  const anyUnsupported = lines.some((line) => line.tone === 'unsupported');
  const anyLanded = lines.some((line) => line.tone === 'applied');
  const tone: AssemblyApplySummaryV1['tone'] = anyFailed
    ? (anyLanded ? 'partial' : 'failed')
    : anyUnsupported ? 'partial' : 'applied';
  const headline = tone === 'applied'
    ? '全部成功'
    : tone === 'partial'
      ? '部分完成 · 未成功或不支持的来源保留在原处'
      : '投放失败 · 没有来源落地';
  return { tone, headline, lines };
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

function captureTitle(item: CaptureStagingItemV0): string {
  const source = item.source as Readonly<Record<string, unknown>>;
  const title = source['title'];
  if (typeof title === 'string' && title.trim() !== '') return title;
  const url = source['url'];
  if (typeof url === 'string' && url.trim() !== '') return url;
  const localPath = source['localPath'];
  if (typeof localPath === 'string' && localPath.trim() !== '') return localPath;
  return item.kind;
}

type AssemblyPreviewKindV1 = 'text' | 'image' | 'url' | 'local_path' | 'descriptor' | 'skill' | 'unknown';

interface AssemblyPreviewV1 {
  readonly status: 'loading' | 'ready' | 'error';
  readonly subjectKey: string;
  readonly title: string;
  readonly kind: AssemblyPreviewKindV1;
  readonly text?: string;
  readonly dataUrl?: string;
  readonly url?: string;
  readonly path?: string;
  readonly error?: string;
  readonly lines?: readonly { readonly label: string; readonly value: string }[];
}
export function AssemblyBody({
  projectId,
  targetRef,
}: {
  readonly projectId: string;
  readonly targetRef: AssemblyTargetRefV1;
}): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const navigate = useNavigate();
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const beginChildNavigation = useLcosShellStore((s) => s.beginChildNavigation);
  const openWindow = useLcosShellStore((s) => s.openWindow);
  const referencedRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);

  const controller = useMemo(
    () => new AssemblySourceBayController({
      assembly: session.assembly,
      captureSpace: session.captureSpace,
      resources: session.resources,
      skills: session.skills,
    }),
    [session],
  );
  const bay = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.read(),
  );

  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [workspaceError, setWorkspaceError] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [applyResult, setApplyResult] = useState<AssemblyApplyResultV1 | null>(null);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssemblyPreviewV1 | undefined>(undefined);

  useEffect(() => {
    controller.open(projectId);
    return () => controller.dispose();
  }, [controller, projectId]);

  useEffect(() => {
    // Project 切换：清掉旧 Project 的选择 / 预览 / 回执，再加载新 Project 的现场信息。
    setApplyResult(null);
    setPreview(undefined);
    setActiveItemKey(null);
    setSearchInput('');
    setWorkspaces([]);
    setWorkspaceError(false);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void session.projects
      .getWorkspaces(projectId)
      .then((sites) => {
        if (!active) return;
        setWorkspaces(sites);
        setWorkspaceError(false);
      })
      .catch(() => {
        if (!active) return;
        // 现场信息是 Assembly 的旁路（用于 target 解析），失败不能打死材料浏览。
        setWorkspaceError(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, session]);

  const tab: AssemblySourceTabV1 = bay?.tab ?? 'project';

  const selectTab = (next: AssemblySourceTabV1): void => {
    controller.selectTab(next);
    controller.loadTab(next);
  };

  const addToComposer = (item: WarehouseItemV1): void => {
    // 加入统一 Composer 草稿（reference store draft；Selection≠Reference）
    useLcosReferenceStore.getState().addEntityToDraft({
      entityType: item.kind,
      entityId: item.entityRef.id,
      ...(item.title === undefined ? {} : { displayLabel: item.title }),
    });
  };

  const applySource = useCallback((sourceRef: AssemblySourceRefV1, refreshTab?: AssemblySourceTabV1): void => {
    setApplyingKey(`${sourceRef.kind}:${sourceRef.id}`);
    setApplyResult(null);
    void session.assembly
      .apply(projectId, {
        schemaVersion: 1,
        projectId,
        sourceRefs: [sourceRef],
        targetRef,
      })
      .then((result) => {
        setApplyResult(result);
        // canonical result refresh：只重读真的会被 apply 改变的那一路（Capture 物化后 resolved 变化）。
        if (refreshTab !== undefined) void controller.refreshApplied([refreshTab]);
      })
      .catch((error: unknown) => {
        setApplyResult({
          schemaVersion: 1,
          projectId,
          results: [{
            sourceRef,
            status: 'failed',
            channel: 'error',
            message: error instanceof Error ? error.message : String(error),
          }],
          allApplied: false,
        });
      })
      .finally(() => setApplyingKey(null));
  }, [controller, projectId, session, targetRef]);

  const beginAssemblyDrag = (
    event: React.DragEvent<HTMLDivElement>,
    itemId: string,
    sourceRef: AssemblySourceRefV1,
  ): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(
      'application/x-lcos-assembly',
      JSON.stringify({ itemId, sourceRef }),
    );
    acquireDrop({ kind: 'assembly', itemId, sourceRef });
  };

  const finishAssemblyDrag = (): void => {
    const store = useLcosDropStore.getState();
    if (store.state.status === 'preview' && store.resolution?.status === 'ready') {
      const transactionId = globalThis.crypto?.randomUUID?.() ?? `drop-${Date.now()}`;
      store.commitAt(transactionId);
      return;
    }
    if (
      store.state.status === 'tracking' ||
      store.state.status === 'dwell' ||
      store.state.status === 'preview'
    ) {
      store.cancel();
    }
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

  // ---- 预览（transient read；不改 Source Bay 状态）----

  const previewCapture = (item: CaptureStagingItemV0): void => {
    const subjectKey = `capture:${item.id}`;
    setPreview({ status: 'loading', subjectKey, title: captureTitle(item), kind: 'unknown' });
    void controller.previewCapture(item.id)
      .then((value) => {
        setPreview({
          status: 'ready',
          subjectKey,
          title: captureTitle(item),
          kind: value.type,
          ...(value.text === undefined ? {} : { text: value.text }),
          ...(value.dataUrl === undefined ? {} : { dataUrl: value.dataUrl }),
          ...(value.url === undefined ? {} : { url: value.url }),
          ...(value.path === undefined ? {} : { path: value.path }),
        });
      })
      .catch((error: unknown) => {
        setPreview({ status: 'error', subjectKey, title: captureTitle(item), kind: 'unknown', error: error instanceof Error ? error.message : String(error) });
      });
  };

  const previewResource = (resourceId: string, title: string): void => {
    const subjectKey = `resource:${resourceId}`;
    setPreview({ status: 'loading', subjectKey, title, kind: 'descriptor' });
    void controller.readResourceDescriptor(resourceId)
      .then((descriptor: ResourceDescriptorV0) => {
        setPreview({
          status: 'ready',
          subjectKey,
          title,
          kind: 'descriptor',
          lines: [
            { label: '来源', value: descriptor.source.kind },
            { label: '理解状态', value: descriptor.understanding.status },
            ...(descriptor.understanding.summary === undefined ? [] : [{ label: '摘要', value: descriptor.understanding.summary }]),
            { label: '信任', value: descriptor.trust.level },
            ...(descriptor.detectedKinds.length === 0
              ? []
              : [{ label: '识别', value: descriptor.detectedKinds.map((kind) => kind.kind).join('、') }]),
          ],
        });
      })
      .catch((error: unknown) => {
        setPreview({ status: 'error', subjectKey, title, kind: 'descriptor', error: error instanceof Error ? error.message : String(error) });
      });
  };

  const previewSkill = (entry: SkillCatalogEntryV1): void => {
    const subjectKey = `skill:${entry.id}`;
    setPreview({ status: 'loading', subjectKey, title: entry.name, kind: 'skill' });
    void controller.readSkill(entry.id)
      .then((value) => {
        setPreview({ status: 'ready', subjectKey, title: entry.name, kind: 'skill', text: value.content });
      })
      .catch((error: unknown) => {
        setPreview({ status: 'error', subjectKey, title: entry.name, kind: 'skill', error: error instanceof Error ? error.message : String(error) });
      });
  };

  const referencedKeySet = useMemo(
    () => new Set(referencedRefs.map((ref) => `assembly:${ref.entityType}:${ref.entityId}`)),
    [referencedRefs],
  );

  const summary = applyResult === null ? undefined : describeAssemblyApplyResultV1(applyResult);
  return (
    <div
      data-lcos-assembly
      data-lcos-assembly-target={targetRef.kind}
      data-lcos-assembly-target-id={'id' in targetRef ? targetRef.id : ''}
      className="flex flex-col gap-3 p-4"
    >
      {/* Source Bay tab：四路共用同一个 Assembly region；切 tab 只换数据源，不换窗口。
          注意：这里刻意不使用 role=tab —— R2-4 的不变量是「role=tab 只属于显式窗口组」。 */}
      <div data-lcos-assembly-source-tabs className="flex items-center gap-1" aria-label="Assembly 来源">
        {(['project', 'capture', 'sources', 'skills'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            data-lcos-assembly-source-tab={key}
            onClick={() => selectTab(key)}
            className="rounded-full px-3 py-1.5 text-xs"
            style={{
              background: tab === key ? lcosTokens.color.inverse : lcosTokens.color.raised,
              color: tab === key ? lcosTokens.color.textOnInverse : lcosTokens.color.text,
              minHeight: 32,
            }}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
        <span className="ml-auto truncate text-[10px]" style={{ color: lcosTokens.color.muted }}>
          {TAB_OWNER_LABEL[tab]} · 投放到{targetLabel(targetRef)}
        </span>
      </div>

      {/* Project Warehouse：canonical 搜索 + 分页 */}
      {tab === 'project' && (
        <div data-lcos-assembly-source-panel="project" className="flex flex-col gap-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              controller.setWarehouseSearch(searchInput);
            }}
          >
            <label className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.raised }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索仓库（服务端 canonical search）"
                data-lcos-assembly-search
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: lcosTokens.color.text }}
              />
            </label>
            <button type="submit" className="min-h-11 rounded-full px-3 text-xs" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}>
              搜索
            </button>
            {(bay?.warehouseSearch ?? '') !== '' && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); controller.setWarehouseSearch(''); }}
                className="min-h-11 rounded-full px-3 text-xs"
                style={{ color: lcosTokens.color.muted }}
              >
                清除
              </button>
            )}
          </form>
          <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
            {bay?.warehouse?.items.length ?? 0} 项
            {bay?.warehouse?.totalApprox === undefined ? '' : ` · 约 ${bay.warehouse.totalApprox} 项`}
          </span>

          {bay?.warehouseStatus === 'loading' && (
            <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取项目仓库…" /></div>
          )}
          {bay?.warehouseStatus === 'error' && (
            <div className="py-10" data-lcos-assembly-error="project">
              <LcosSurfaceFeedback presentation="error" message={`仓库读取失败（${bay.warehouseErrorCode ?? 'read_error'}）`} onAction={() => controller.reloadWarehouse()} />
            </div>
          )}
          {workspaceError && bay?.warehouseStatus === 'loaded' && (
            <div className="flex items-center gap-2 py-2 text-xs" style={{ color: lcosTokens.color.muted }}>
              <span>现场信息读取失败，材料仍可使用。</span>
              <button
                type="button"
                data-lcos-assembly-workspace-retry
                onClick={() => {
                  void session.projects.getWorkspaces(projectId)
                    .then((sites) => { setWorkspaces(sites); setWorkspaceError(false); })
                    .catch(() => setWorkspaceError(true));
                }}
                className="min-h-11 rounded-full px-3"
              >
                重试读取现场
              </button>
            </div>
          )}

          {bay?.warehouseStatus === 'loaded' && (bay.warehouse?.items.length ?? 0) === 0 && (
            <div className="py-10"><LcosSurfaceFeedback presentation="empty" message={EMPTY_TAB_TEXT.project} /></div>
          )}

          {bay?.warehouseStatus === 'loaded' && (bay.warehouse?.items.length ?? 0) > 0 && (
            <>
              <div className="max-h-[52vh] overflow-y-auto pr-1">
                <div className="columns-1 gap-4 sm:columns-2" data-lcos-assembly-waterfall>
                  {bay.warehouse!.items.map((item) => {
                    const card = assemblyCardViewV1(item, referencedKeySet);
                    const itemKey = `${item.kind}:${item.entityRef.id}`;
                    const previewUrl = previewUrlOf(item);
                    return (
                      <div
                        key={itemKey}
                        data-lcos-assembly-item={item.entityRef.id}
                        data-lcos-assembly-item-kind={item.kind}
                        data-lcos-assembly-item-species={card.species}
                        data-lcos-assembly-visual-family={item.visualFamily ?? item.kind}
                        draggable
                        onDragStart={(event) => beginAssemblyDrag(event, item.entityRef.id, assemblySourceRefOf(item))}
                        onDragEnd={finishAssemblyDrag}
                        className="group mb-4 flex break-inside-avoid flex-col gap-2 rounded-2xl p-3 transition-shadow hover:shadow-md focus-within:shadow-md"
                        onMouseEnter={() => setActiveItemKey(itemKey)}
                        onMouseLeave={() => setActiveItemKey((current) => current === itemKey ? null : current)}
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
                          {card.subtitle !== undefined ? <span>{card.subtitle}</span> : null}
                          {item.usageCount > 0 ? <span>· 使用 {item.usageCount}</span> : null}
                          {card.referenced ? <span>· 已在草稿</span> : null}
                        </div>
                        <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                          {item.updatedAt ? <span>{new Date(item.updatedAt).toLocaleDateString()}</span> : null}
                          {item.usedHere ? <span>· 已在此处</span> : null}
                        </div>
                        <button
                          type="button"
                          data-lcos-assembly-more
                          aria-expanded={activeItemKey === itemKey}
                          onClick={() => setActiveItemKey((current) => current === itemKey ? null : itemKey)}
                          className="self-start rounded-full px-2 py-1 text-xs"
                          style={{ color: lcosTokens.color.info }}
                        >
                          取用
                        </button>
                        <div data-lcos-assembly-actions className={`${activeItemKey === itemKey ? 'flex' : 'hidden'} items-center gap-1 group-focus-within:flex`}>
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
                            disabled={applyingKey !== null}
                            onClick={() => applySource(assemblySourceRefOf(item))}
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
              {bay.warehouseNextCursor !== undefined && (
                <button
                  type="button"
                  data-lcos-assembly-page-more
                  disabled={bay.warehouseLoadingMore}
                  onClick={() => controller.loadMoreWarehouse()}
                  className="self-center rounded-full px-4 py-2 text-xs"
                  style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text, minHeight: 36 }}
                >
                  {bay.warehouseLoadingMore ? '读取中…' : '加载更多'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {/* Capture Space（system-level staging） */}
      {tab === 'capture' && (
        <div data-lcos-assembly-source-panel="capture" className="flex flex-col gap-2">
          {bay?.captureStatus === 'loading' && (
            <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取暂存区…" /></div>
          )}
          {bay?.captureStatus === 'error' && (
            <div className="py-10" data-lcos-assembly-error="capture">
              <LcosSurfaceFeedback presentation="error" message={`暂存区读取失败（${bay.captureErrorCode ?? 'read_error'}）`} onAction={() => controller.reloadCapture()} />
            </div>
          )}
          {bay?.captureStatus === 'loaded' && (bay.captureItems?.length ?? 0) === 0 && (
            <div className="py-10"><LcosSurfaceFeedback presentation="empty" message={EMPTY_TAB_TEXT.capture} /></div>
          )}
          {bay?.captureStatus === 'loaded' && (bay.captureItems?.length ?? 0) > 0 && bay.captureItems!.map((item) => (
            <div
              key={item.id}
              data-lcos-assembly-capture-item={item.id}
              draggable
              onDragStart={(event) => beginAssemblyDrag(event, item.id, { kind: 'capture', id: item.id })}
              onDragEnd={finishAssemblyDrag}
              className="flex flex-col gap-1.5 rounded-2xl p-3"
              style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" style={{ color: lcosTokens.color.text }}>{captureTitle(item)}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>{item.kind}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                <span>{new Date(item.capturedAt).toLocaleString()}</span>
                {item.resolvedProjectId === undefined
                  ? <span>· 未物化</span>
                  : <span>· 已物化到 {item.resolvedProjectId === projectId ? '本项目' : item.resolvedProjectId}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" data-lcos-assembly-preview-open={`capture:${item.id}`} onClick={() => previewCapture(item)} className="min-h-11 rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.info }}>预览</button>
                <button
                  type="button"
                  disabled={applyingKey !== null}
                  onClick={() => applySource({ kind: 'capture', id: item.id }, 'capture')}
                  title={`物化并投放到${targetLabel(targetRef)}（幂等：已物化则复用既有产物）`}
                  data-lcos-assembly-drop
                  className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                  style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 32 }}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden /> 投放
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resources / Sources */}
      {tab === 'sources' && (
        <div data-lcos-assembly-source-panel="sources" className="flex flex-col gap-2">
          {bay?.resourceStatus === 'loading' && (
            <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取来源…" /></div>
          )}
          {bay?.resourceStatus === 'error' && (
            <div className="py-10" data-lcos-assembly-error="sources">
              <LcosSurfaceFeedback presentation="error" message={`来源读取失败（${bay.resourceErrorCode ?? 'read_error'}）`} onAction={() => controller.reloadResources()} />
            </div>
          )}
          {bay?.resourceStatus === 'loaded' && (bay.resources?.length ?? 0) === 0 && (
            <div className="py-10"><LcosSurfaceFeedback presentation="empty" message={EMPTY_TAB_TEXT.sources} /></div>
          )}
          {bay?.resourceStatus === 'loaded' && (bay.resources?.length ?? 0) > 0 && bay.resources!.map((resource) => (
            <div
              key={resource.resourceId}
              data-lcos-assembly-resource-item={resource.resourceId}
              draggable
              onDragStart={(event) => beginAssemblyDrag(event, resource.resourceId, { kind: 'resource', id: resource.resourceId })}
              onDragEnd={finishAssemblyDrag}
              className="flex flex-col gap-1.5 rounded-2xl p-3"
              style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" style={{ color: lcosTokens.color.text }}>{resource.title}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>{resource.sourceKind}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                <span>理解：{resource.status}</span>
                <span>· 分析器 {resource.analyzerVersion}</span>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" data-lcos-assembly-preview-open={`resource:${resource.resourceId}`} onClick={() => previewResource(resource.resourceId, resource.title)} className="min-h-11 rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.info }}>预览</button>
                <button
                  type="button"
                  disabled={applyingKey !== null}
                  onClick={() => applySource({ kind: 'resource', id: resource.resourceId })}
                  title={`经 canonical descriptor 投放到${targetLabel(targetRef)}`}
                  data-lcos-assembly-drop
                  className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                  style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 32 }}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden /> 投放
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Skills（分层只读） */}
      {tab === 'skills' && (
        <div data-lcos-assembly-source-panel="skills" className="flex flex-col gap-2">
          <div data-lcos-assembly-skill-admission="read-only" className="rounded-xl px-3 py-2 text-[11px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
            v0.15 技能只读：可以浏览、阅读与预览，但不能投放（usage-binding 延后到 0.2）。Assembly 不复制 Skill package，也不伪造绑定。
          </div>
          {bay?.skillStatus === 'loading' && (
            <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取技能…" /></div>
          )}
          {bay?.skillStatus === 'error' && (
            <div className="py-10" data-lcos-assembly-error="skills">
              <LcosSurfaceFeedback presentation="error" message={`技能读取失败（${bay.skillErrorCode ?? 'read_error'}）`} onAction={() => controller.reloadSkills()} />
            </div>
          )}
          {bay?.skillStatus === 'loaded' && (bay.skills?.length ?? 0) === 0 && (
            <div className="py-10"><LcosSurfaceFeedback presentation="empty" message={EMPTY_TAB_TEXT.skills} /></div>
          )}
          {bay?.skillStatus === 'loaded' && (bay.skills?.length ?? 0) > 0 && bay.skills!.map((entry) => (
            <div
              key={entry.id}
              data-lcos-assembly-skill-item={entry.id}
              className="flex flex-col gap-1.5 rounded-2xl p-3"
              style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" style={{ color: lcosTokens.color.text }}>{entry.name}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>{SKILL_SOURCE_LABEL[entry.source]}</span>
              </div>
              {entry.description !== '' && (
                <div className="text-[11px]" style={{ color: lcosTokens.color.muted }}>{entry.description}</div>
              )}
              <div className="flex items-center gap-1">
                <button type="button" data-lcos-assembly-preview-open={`skill:${entry.id}`} onClick={() => previewSkill(entry)} className="min-h-11 rounded-full px-2 py-1 text-xs" style={{ color: lcosTokens.color.info }}>阅读</button>
                <span data-lcos-assembly-skill-apply="unavailable" className="ml-auto rounded-full px-2 py-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                  不可投放
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`@media (hover: none), (pointer: coarse) { [data-lcos-assembly-actions] { display: flex; } }`}</style>

      {/* 预览：capture payload / resource descriptor / skill 正文 */}
      {preview !== undefined && (
        <div
          data-lcos-assembly-preview={preview.status}
          data-lcos-assembly-preview-subject={preview.subjectKey}
          className="flex flex-col gap-2 rounded-xl px-3 py-2"
          style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs font-semibold" style={{ color: lcosTokens.color.text }}>{preview.title}</span>
            <button type="button" data-lcos-assembly-preview-close onClick={() => setPreview(undefined)} className="min-h-11 shrink-0 rounded-full px-3 text-xs" style={{ color: lcosTokens.color.muted }}>关闭预览</button>
          </div>
          {preview.status === 'loading' && (
            <span className="text-[11px]" style={{ color: lcosTokens.color.muted }}>正在读取预览…</span>
          )}
          {preview.status === 'error' && (
            <span className="text-[11px]" style={{ color: lcosTokens.color.danger }}>预览读取失败{preview.error === undefined ? '' : `（${preview.error}）`}</span>
          )}
          {preview.status === 'ready' && preview.kind === 'image' && preview.dataUrl !== undefined && (
            <img src={preview.dataUrl} alt="" className="max-h-64 w-full rounded-xl object-contain" />
          )}
          {preview.status === 'ready' && preview.kind === 'image' && preview.dataUrl === undefined && (
            <span className="text-[11px]" style={{ color: lcosTokens.color.muted }}>这张图像没有可读内容</span>
          )}
          {preview.status === 'ready' && preview.text !== undefined && (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px]" style={{ color: lcosTokens.color.text }}>{preview.text}</pre>
          )}
          {preview.status === 'ready' && preview.url !== undefined && (
            <span className="break-all text-[11px]" style={{ color: lcosTokens.color.info }}>{preview.url}</span>
          )}
          {preview.status === 'ready' && preview.path !== undefined && (
            <span className="break-all text-[11px]" style={{ color: lcosTokens.color.muted }}>{preview.path}</span>
          )}
          {preview.status === 'ready' && preview.lines !== undefined && (
            <div className="flex flex-col gap-1">
              {preview.lines.map((line) => (
                <div key={line.label} className="flex items-start gap-2 text-[11px]">
                  <span className="w-16 shrink-0" style={{ color: lcosTokens.color.muted }}>{line.label}</span>
                  <span className="min-w-0 break-words" style={{ color: lcosTokens.color.text }}>{line.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 逐项 apply 回执 */}
      {summary !== undefined && (
        <div
          data-lcos-assembly-receipt
          data-lcos-assembly-outcome={summary.tone}
          className="rounded-xl px-3 py-2"
          style={{
            background: summary.tone === 'applied' ? 'rgba(84,116,100,0.08)' : summary.tone === 'partial' ? 'rgba(176,138,72,0.10)' : 'rgba(194,91,78,0.08)',
            color: summary.tone === 'applied' ? lcosTokens.color.accent : summary.tone === 'partial' ? lcosTokens.color.pinAmber : lcosTokens.color.danger,
          }}
        >
          {summary.lines.map((line) => (
            <div key={line.key} data-lcos-assembly-outcome-line={line.tone} className="flex items-center justify-between gap-2 py-0.5 text-xs">
              <span>
                {line.label}
                {line.detail === undefined ? '' : ` · ${line.detail}`}
              </span>
              {line.changeSetId !== undefined && <span className="shrink-0 text-[10px] opacity-70">已记录变更 {line.changeSetId.slice(0, 8)}</span>}
            </div>
          ))}
          <div className="text-[11px]">{summary.headline}</div>
        </div>
      )}
    </div>
  );
}