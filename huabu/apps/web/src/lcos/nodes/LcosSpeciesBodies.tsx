import { toggleCollectionHost } from './collectionHost';
// LcosSpeciesBodies — 节点物种 body 注册表（Figma Main/NodeSpecies 语义；宪法 P11 内容优先）。
// 形态语言：结构化区分（图标/边框/角标/比例/状态位），不只靠颜色。
// 所有 body 只接收中性 slot input（nodeId/nodeType/data），不直连 Core/Huabu store（只读 data）。
// unknown 不静默降级——显示诊断原因。

import {
  NODE_SPECIES_LABEL,
  resolveVisualFamily,
  type LcosNodeSpecies,
  type LcosVisualFamily,
} from '@local-creative-os/web-gen2';
import {
  Bookmark,
  CircleDot,
  Puzzle,
  Router,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { resolveArtifactUrl } from '@/api/artifact';
import { toast } from '@/components/Common/Toast';
import { DropdownMenu, DropdownMenuItem } from '@/components/Common/DropdownMenu';
import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';
import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { SourceMorphology } from './source/SourceMorphology';
import { useLcosDensity } from './useLcosDensity';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { beginChildWorksiteNavigation } from '../navigation/childWorksiteNavigation';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';
import { CollectionNodePresentation } from './CollectionNodePresentation';
import { NodeColorPinMarkers } from './NodeColorPinMarkers';
import { NodeReferenceMarker } from './NodeReferenceMarker';
import { useLcosDropStore } from '../lcosDropState';
import { isDropPointExposed, isCollectionHostPointExposed } from '../drop/dropOcclusion';
import { rectFromDomRect } from '../drop/dropTargetRegistry';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { Workspace } from '@local-creative-os/domain';
import type { ComponentType, JSX } from 'react';

/** 物种 → 主识别色（边缘/角标；浓度统一收敛，不作为唯一区分）。 */
export const SPECIES_ACCENT: Readonly<Record<LcosNodeSpecies, string>> = {
  source: lcosTokens.color.muted,
  working: lcosTokens.color.info,
  draft: lcosTokens.color.pinAmber,
  'context-reference': lcosTokens.color.pinTeal,
  run: lcosTokens.color.pinViolet,
  'result-slot': lcosTokens.color.muted,
  decision: lcosTokens.color.accent,
  glyth: lcosTokens.color.inverse,
  collection: lcosTokens.color.info,
  'workflow-collection': lcosTokens.color.pinTeal,
  portal: lcosTokens.color.pinViolet,
  'prompt-frame': lcosTokens.color.pinAmber,
  unknown: lcosTokens.color.danger,
};

function titleOf(data: Readonly<Record<string, unknown>> | undefined): string {
  const raw = data?.label ?? data?.title;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '未命名';
}

function SpeciesChip({ label, accent }: { label: string; accent: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
      style={{
        color: accent,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
        minHeight: 18,
      }}
    >
      {label}
    </span>
  );
}

function TitleLine({ text, density }: { text: string; density?: 'mark' | 'summary' | 'working' | 'reading' }): JSX.Element {
  // 近景（reading）用更大的标题：Main 首屏的"可辨身份"主要靠标题，而不是靠放大到 200%。
  const large = density === 'reading';
  return (
    <span
      className={`line-clamp-2 font-semibold leading-snug ${large ? 'text-lg' : 'text-sm'}`}
      style={{ color: lcosTokens.color.text }}
    >
      {text}
    </span>
  );
}

function MetaLine({ text }: { text: string }): JSX.Element {
  // 次级行永远贴在卡片底部：卡片随之有真实的信息层级（标题在上、事实在下），
  // 而不是一坨居中文字漂在空白里（首轮视觉否决的"构图极空"）。
  return (
    <span className="mt-auto block text-[11px]" style={{ color: lcosTokens.color.muted }}>
      {text}
    </span>
  );
}

/** 各物种 body 内容（frame 由 LcosSpeciesBody / GlythNodeBody 提供）。 */
export function LcosSpeciesBodyContent({
  species,
  title,
  density,
  secondary,
  preview,
  visualFamily = 'unknown',
  mediaSrc,
  durationSec,
  zoom,
  worldWidth,
  worldHeight,
  sourceRunId,
  nodeId,
  projectId,
  fileRecordId,
  mimeType,
  artifactKind,
  workflowAction,
  workflowDisabled,
  workflowDisabledReason,
  collectionMemberCount,
  collectionMemberLabels,
  collectionMembers, collectionId,
  onRemoveCollectionMember,
  collectionFrameExpanded, collectionActivationSuppressed, collectionSelected, collectionDragging,
  collectionFrameDisabledReason,
  onToggleCollectionFrame,
}: {
  species: LcosNodeSpecies;
  title: string;
  density: 'mark' | 'summary' | 'working' | 'reading';
  visualFamily?: LcosVisualFamily;
  mediaSrc?: string;
  durationSec?: number;
  zoom?: number;
  worldWidth?: number;
  worldHeight?: number;
  sourceRunId?: string;
  nodeId?: string;
  projectId?: string;
  fileRecordId?: string;
  mimeType?: string;
  artifactKind?: string;
  workflowAction?: JSX.Element;
  workflowDisabled?: boolean;
  workflowDisabledReason?: string;
  collectionMemberCount?: number;
  collectionMemberLabels?: readonly string[];
  collectionId?: string;
  collectionMembers?: readonly { readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run'; readonly id: string; readonly label: string }[];
  onRemoveCollectionMember?: (memberRef: { readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run'; readonly id: string }) => Promise<boolean>;
  collectionFrameExpanded?: boolean;
  collectionActivationSuppressed?: boolean;
  collectionSelected?: boolean;
  collectionDragging?: boolean;
  collectionFrameDisabledReason?: string;
  onToggleCollectionFrame?: () => Promise<boolean>;
  /**
   * 真实次级行（来自 Core 元数据：kind/受管/可用性/revision）。
   * 有真实事实就显示真实事实；没有就退回该物种的**形态说明**（说清这是什么，不假装有数据）。
   */
  secondary?: string;
  /**
   * 真实正文预览（来自 Core FileRecord 内容，用户裁决 B 的 `preview` 位）。
   * 读不到就不显示（不编造正文）——首屏内容密度靠真实正文，不靠放大节点。
   */
  preview?: string;
}): JSX.Element {
  // `flex: 1` 让内容列撑满 body 高度，次级行才能真正贴底（见上面 source 分支的注释）。
  const root = { display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' as const, gap: 6, width: '100%', minWidth: 0 };
  const meta = (fallback: string): JSX.Element => <MetaLine text={secondary ?? fallback} />;
  switch (species) {
    case 'source':
    case 'draft':
      return (
        <div style={{ ...root, position: 'relative' }} data-lcos-species={species} data-lcos-visual-family={visualFamily}>
          <SourceMorphology
            family={visualFamily}
            nodeId={nodeId}
            mimeType={mimeType}
            artifactKind={artifactKind}
            title={title}
            secondary={secondary}
            projectId={projectId}
            fileRecordId={fileRecordId}
            preview={preview}
            mediaSrc={mediaSrc}
            durationSec={durationSec}
            density={density}
            zoom={zoom}
            worldWidth={worldWidth}
            worldHeight={worldHeight}
          />
          {sourceRunId && density !== 'mark' && (
            <span className="lcos-generated-source-cue" data-lcos-generated-source title="来自真实运行结果">
              <Sparkles size={11} aria-hidden />生成结果
            </span>
          )}
        </div>
      );

    case 'working':
      return (
        <div style={root} data-lcos-species="working">
          {density !== 'mark' && <SpeciesChip label="加工中" accent={SPECIES_ACCENT.working} />}
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-3 w-1 shrink-0 rounded-full" style={{ background: SPECIES_ACCENT.working }} />
            <div className="min-w-0 flex-1">
              <TitleLine text={title} density={density} />
              {density !== 'mark' && meta('当前加工 · 活跃')}
            </div>
          </div>
        </div>
      );

    case 'context-reference':
      return (
        <div style={root} data-lcos-species="context-reference">
          <div className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT['context-reference'] }} aria-hidden />
            <SpeciesChip label="引用" accent={SPECIES_ACCENT['context-reference']} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('来源锚点 · 可定位')}
        </div>
      );

    case 'run':
      return (
        <div style={root} data-lcos-species="run">
          {density !== 'mark' && (
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full lcos-static-pulse" style={{ background: SPECIES_ACCENT.run }} />
              <SpeciesChip label="运行" accent={SPECIES_ACCENT.run} />
            </div>
          )}
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('执行状态 · 以真实回执为准')}
        </div>
      );

    case 'decision':
      return (
        <div style={root} data-lcos-species="decision" data-figma-node-id="5054:4560">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT.decision }} aria-hidden />
            <SpeciesChip label="决策" accent={SPECIES_ACCENT.decision} />
          </div>
          <span className={`line-clamp-2 font-semibold leading-snug ${density === 'reading' ? 'text-base' : 'text-sm'}`}
            style={{ color: lcosTokens.color.text }}>
            {title}
          </span>
          {density === 'reading' && preview?.trim() ? (
            <span data-lcos-decision-excerpt className="line-clamp-1 text-[13px] leading-[22px]"
              style={{ color: lcosTokens.color.muted }} title={preview}>
              {preview}
            </span>
          ) : density !== 'mark' && secondary?.trim() ? meta(secondary) : null}
        </div>
      );

    case 'glyth':
      return (
        <div style={root} data-lcos-species="glyth">
          <div className="flex h-full items-stretch gap-2">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
            >
              {(title.charAt(0) || '?').toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <TitleLine text={title} density={density} />
              {density !== 'mark' && meta('会话 · 双击打开会话窗口')}
            </div>
          </div>
        </div>
      );

    case 'collection':
    case 'workflow-collection':
      return (
        <div style={{ ...root, height: '100%', overflow: 'visible' }} data-lcos-species={species}>
          <CollectionNodePresentation
            projectId={projectId} collectionId={collectionId}
            kind={species}
            title={title}
            density={density}
            zoom={zoom}
            {...(species === 'collection' && collectionMemberCount !== undefined ? { memberCount: collectionMemberCount } : {})}
            {...(species === 'collection' && collectionMemberLabels !== undefined ? { memberLabels: collectionMemberLabels } : {})}
            {...(species === 'collection' && collectionMembers !== undefined ? { members: collectionMembers } : {})}
            {...(species === 'collection' && onRemoveCollectionMember !== undefined ? { onRemoveMember: onRemoveCollectionMember } : {})}
            {...(species === 'collection' ? { folder: { expanded: collectionFrameExpanded, selected: collectionSelected, dragging: collectionDragging,
              disabledReason: collectionFrameDisabledReason, onToggle: onToggleCollectionFrame,
              suppressActivation: collectionActivationSuppressed } } : {})}
            {...(worldWidth === undefined ? {} : { worldWidth })}
            {...(worldHeight === undefined ? {} : { worldHeight })}
            {...(workflowAction === undefined ? {} : { action: workflowAction })}
            {...(workflowDisabled === undefined ? {} : { disabled: workflowDisabled })}
            {...(workflowDisabledReason === undefined ? {} : { disabledReason: workflowDisabledReason })}
          />
        </div>
      );

    case 'portal':
      return (
        <div style={root} data-lcos-species="portal">
          <div className="flex items-center gap-1.5">
            <Router className="h-4 w-4" style={{ color: SPECIES_ACCENT.portal }} aria-hidden />
            <SpeciesChip label="入口" accent={SPECIES_ACCENT.portal} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('投影锚点 · 进入现场')}
        </div>
      );

    case 'prompt-frame':
      return (
        <div style={root} data-lcos-species="prompt-frame">
          <div className="flex items-center gap-1.5">
            <Puzzle className="h-4 w-4" style={{ color: SPECIES_ACCENT['prompt-frame'] }} aria-hidden />
            <SpeciesChip label="提示" accent={SPECIES_ACCENT['prompt-frame']} />
          </div>
          <TitleLine text={title} density={density} />
        </div>
      );

    case 'unknown':
    default:
      return (
        <div style={root} data-lcos-species="unknown">
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-4 w-4" style={{ color: SPECIES_ACCENT.unknown }} aria-hidden />
            <SpeciesChip label="未分类" accent={SPECIES_ACCENT.unknown} />
          </div>
          <TitleLine text={title} density={density} />
          <MetaLine text="缺少可辨识的 Core 元数据 · 需要诊断" />
        </div>
      );
  }
}

/** 物种 body：密度走 `useLcosDensity`（唯一来源，屏幕像素 + 节点数封顶）。 */
function LcosSpeciesBody({
  species,
  input,
}: {
  species: LcosNodeSpecies;
  input: CanvasNodeBodySlotInput;
}): JSX.Element {
  const density = useLcosDensity();
  const navigate = useNavigate();
  const presentation = useLcosNodePresentation();
  const canvasId = useCanvasStore((state) => state.canvasId);
  const title = titleOf(input.data as Readonly<Record<string, unknown>> | undefined);
  // Core facts are read from the single reference store. The visual family is
  // resolved from those facts, never from a title or node id guess.
  const ref = useLcosReferenceStore((s) => s.nodeEntityRefs.get(input.nodeId));
  const projectId = useLcosReferenceStore((s) => s.projectId);
  const workflowSession = useMemo(() => createLcosCoreSession(), []);
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const collapsedFrameIds = useCanvasStore((state) => state.collapsedFrameIds);
  const collectionDropRef = useRef<HTMLDivElement>(null);
  const registerDropTarget = useLcosDropStore((s) => s.registerTarget);
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const [workflowTargets, setWorkflowTargets] = useState<readonly Workspace[]>([]);
  const [workflowTargetStatus, setWorkflowTargetStatus] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  const descriptor = ref?.descriptor;
  const collectionFrame = canvasNodes.find((node) => node.type === 'frame'
    && (node.data as Record<string, unknown> | undefined)?.lcosCollectionId === ref?.entityId);
  const collectionFrameCollapsed = collectionFrame !== undefined && collapsedFrameIds.has(collectionFrame.id);
  const collectionPickActive = useLcosReferenceStore((state) => state.referencePickOwner !== null);
  const collectionActivationSuppressed = collectionPickActive || canvasNodes.filter((node) => node.selected).length > 1;
  const collectionFrameDisabledReason = species === 'collection' && ref?.entityType !== 'collection' ? '集合身份尚未确认' : undefined;
  const collectionOpening = useRef(false);
  const toggleCollectionFrame = async (): Promise<boolean> => {
    if (ref?.entityType !== 'collection' || !projectId || !canvasId || collectionOpening.current) return false;
    const sameSource = () => useCanvasStore.getState().canvasId === canvasId
      && useLcosReferenceStore.getState().projectId === projectId
      && useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId)?.entityType === 'collection'
      && useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId)?.entityId === ref.entityId;
    if (!sameSource()) return false;
    if (useCanvasStore.getState().nodes.some((node) => node.type === 'frame' && node.data?.lcosCollectionId === ref.entityId))
      return toggleCollectionHost(() => useCanvasStore.getState(), ref.entityId, input.nodeId, title, []);
    const before = useCanvasStore.getState();
    const owner = before.nodes.find((node) => node.id === input.nodeId);
    if (!owner) return false;
    const initialSelection = before.nodes.filter((node) => node.selected).map((node) => node.id).join('\0');
    const initialPosition = { ...owner.position };
    const initialParent = owner.parentId;
    collectionOpening.current = true;
    try {
      // A missing descriptor is not an empty collection. Read its real members
      // before making the first physical host; later opens preserve that host.
      const snapshot = await workflowSession.collections.members(projectId, ref.entityId);
      if (!sameSource()) return false;
      const live = useCanvasStore.getState();
      const liveOwner = live.nodes.find((node) => node.id === input.nodeId);
      if (!liveOwner || liveOwner.dragging || liveOwner.parentId !== initialParent
        || liveOwner.position.x !== initialPosition.x || liveOwner.position.y !== initialPosition.y
        || live.nodes.filter((node) => node.selected).map((node) => node.id).join('\0') !== initialSelection) return false;
      const bindings = useLcosReferenceStore.getState().nodeEntityRefs;
      const memberIds = snapshot.members.flatMap((member) => [...bindings].filter(([id, entity]) =>
        live.nodes.some((node) => node.id === id) && entity.entityType === member.memberRef.type
          && entity.entityId === member.memberRef.id).map(([id]) => id));
      return toggleCollectionHost(() => useCanvasStore.getState(), ref.entityId, input.nodeId, title, memberIds);
    } catch {
      if (sameSource()) toast('成员暂未读到，原内容已保留；再次点击集合可重读。', {tone:'danger'});
      return false;
    } finally { collectionOpening.current = false; }
  };
  const isSourceMaterial = species === 'source' || species === 'draft';
  const visualFamily = isSourceMaterial
    ? resolveVisualFamily({
        entityType: ref?.entityType,
        artifactKind: descriptor?.artifactKind,
        mimeType: descriptor?.mimeType,
        sourceKind: descriptor?.sourceKind,
        managed: descriptor?.managed,
        revisionStatus: descriptor?.revisionStatus,
      })
    : 'unknown';
  const presentationMediaSrc = input.data.presentationMediaSrc;
  const rawMediaSrc = input.data.src;
  const mediaSrc =
    typeof presentationMediaSrc === 'string' && presentationMediaSrc !== ''
      ? presentationMediaSrc
      : typeof rawMediaSrc === 'string' && rawMediaSrc !== ''
        ? resolveArtifactUrl(rawMediaSrc, canvasId ?? undefined)
        : undefined;
  const rawDuration = input.data.presentationDurationSec;
  const durationSec = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : undefined;
  const isFreeformBody = isSourceMaterial || species === 'collection' || species === 'workflow-collection';
  useEffect(() => {
    if (species !== 'workflow-collection' || projectId === null || ref?.entityType !== 'scope' || ref.entityId === '') {
      setWorkflowTargets([]);
      setWorkflowTargetStatus('idle');
      return;
    }
    let active = true;
    setWorkflowTargets([]);
    setWorkflowTargetStatus('loading');
    void workflowSession.projects.getWorkspaces(projectId)
      .then((workspaces) => {
        if (!active) return;
        const targets = workspaces.filter((workspace) => String(workspace.scopeId) === ref.entityId);
        setWorkflowTargets(targets);
        setWorkflowTargetStatus(targets.length === 0 ? 'missing' : 'ready');
      })
      .catch(() => {
        if (!active) return;
        setWorkflowTargets([]);
        setWorkflowTargetStatus('missing');
      });
    return () => { active = false; };
  }, [projectId, ref?.entityId, ref?.entityType, species, workflowSession]);
  useEffect(() => {
    const element = collectionDropRef.current;
    if (species !== 'collection' || projectId === null || ref?.entityType !== 'collection' || activeSurface !== 'main' || !element) return;
    const targetId = `collection-membership:${ref.entityId}`;
    const readRect = () => element.isConnected ? rectFromDomRect(element.getBoundingClientRect()) : undefined;
    const rect = readRect();
    if (!rect) return;
    return registerDropTarget({
      targetId,
      kind: 'collection-membership',
      nodeId: input.nodeId,
      label: title,
      rect,
      readRect,
      acceptsPoint: (point) => isDropPointExposed(element, point),
      priority: 30,
      enabled: true,
      semantic: { kind: 'collection-membership', collectionId: ref.entityId },
    });
  }, [activeSurface, projectId, ref?.entityId, ref?.entityType, registerDropTarget, species, title, input.nodeId]);
  useEffect(() => {
    if (species !== 'collection' || ref?.entityType !== 'collection' || !collectionFrame || collectionFrameCollapsed) return;
    const frameId = collectionFrame.id;
    const findFrame = () => [...(useCanvasStore.getState().canvasWrapper?.querySelectorAll('.react-flow__node') ?? [])]
      .find((element) => element.getAttribute('data-id') === frameId);
    const readRect = () => {
      const state = useCanvasStore.getState();
      const node = state.nodes.find((candidate) => candidate.id === frameId);
      if (!node || node.hidden || state.collapsedFrameIds.has(frameId)) return undefined;
      const element = findFrame();
      return element?.isConnected ? rectFromDomRect(element.getBoundingClientRect()) : undefined;
    };
    const rect = readRect();
    if (!rect) return;
    return registerDropTarget({
      targetId: `collection-host:${frameId}`, nodeId: frameId,
      kind: 'collection-membership', label: title, priority: 15,
      rect, readRect,
      acceptsPoint: (point) => {
        const state = useCanvasStore.getState();
        const element = findFrame();
        return Boolean(element && state.canvasWrapper
          && isCollectionHostPointExposed(element, state.canvasWrapper, point,
            state.nodes.filter((node) => node.parentId === frameId).map((node) => node.id)));
      },
      enabled: collectionFrame.data.locked !== true,
      ...(collectionFrame.data.locked === true ? { ineligibleReason: '该集合空间已锁定' } : {}),
      semantic: { kind: 'collection-membership', collectionId: ref.entityId },
    });
  }, [species, ref?.entityType, ref?.entityId, collectionFrame?.id, collectionFrame?.data.locked, collectionFrameCollapsed, registerDropTarget, title]);
  const workflowUnavailableReason = projectId === null
    ? '项目身份尚未就绪'
    : ref?.entityType !== 'scope'
      ? '缺少 Workflow scope 身份'
      : workflowTargetStatus === 'loading'
        ? '正在读取 Workflow 现场'
        : workflowTargetStatus === 'missing'
          ? '该 Workflow 尚未关联现场'
          : workflowTargets.every((workspace) => workspace.canvasId === undefined)
            ? '该 Workflow 现场尚未就绪'
            : undefined;
  const enterWorkflow = (targetWorkspace: Workspace): void => {
    if (projectId === null || targetWorkspace.canvasId === undefined) return;
    beginChildWorksiteNavigation({
      projectId,
      sourceSurface: 'main',
      sourceWasChild: false,
      targetSurface: 'workflow',
      targetWorkspace,
      sourceNodeId: input.nodeId,
      navigate,
    });
  };
  const workflowAction = species === 'workflow-collection' && workflowUnavailableReason === undefined
    ? workflowTargets.length > 1
      ? <DropdownMenu trigger={<button type="button" aria-label={`选择 ${title} 的工作现场`}
          title="选择工作现场" className="nodrag nopan" onPointerDown={(event) => event.stopPropagation()}>↗</button>}>
          {workflowTargets.map((workspace) => <DropdownMenuItem key={String(workspace.id)}
            disabled={workspace.canvasId === undefined} onClick={() => enterWorkflow(workspace)}>
            {workspace.name || '未命名现场'}{workspace.canvasId === undefined ? ' · 画布尚未就绪' : ''}
          </DropdownMenuItem>)}
        </DropdownMenu>
      : workflowTargets[0] === undefined ? undefined : <button type="button"
          aria-label={`进入 Workflow · ${title}`} title="进入 Workflow 现场" className="nodrag nopan"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); enterWorkflow(workflowTargets[0]!); }}>↗</button>
    : undefined;
  return (
    <div
      data-lcos-species-body
      ref={collectionDropRef}
      data-lcos-density={density}
      data-lcos-visual-family={visualFamily}
      className={`relative flex h-full w-full flex-col ${isFreeformBody ? 'overflow-visible' : 'overflow-hidden'}`}
      onDoubleClick={
        isSourceMaterial && ref?.entityType === 'artifact'
          ? (event) => {
              if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, video, audio')) return;
              event.stopPropagation();
              const shell = useLcosShellStore.getState();
              const presentedRevisionId = descriptor?.presentedRevisionId ?? descriptor?.currentRevisionId;
              shell.openReader(`阅读 · ${title}`, ref.entityId, {
                ...(presentedRevisionId === undefined ? {} : { revisionId: presentedRevisionId }),
                source: { surface: shell.activeSurface, nodeId: input.nodeId },
              });
            }
          : undefined
      }
      style={isFreeformBody
        ? { background: 'transparent', border: 0, borderRadius: 0, boxShadow: 'none', padding: 0,
            '--lcos-source-caption-size': `${Math.max(12, 10.5 / Math.max(.1, presentation?.zoom ?? 1))}px`,
            '--lcos-source-caption-leading': `${Math.max(19, 16 / Math.max(.1, presentation?.zoom ?? 1))}px`,
          } as import('react').CSSProperties
        : {
            background: lcosTokens.color.surface,
            border: `1px solid color-mix(in srgb, ${SPECIES_ACCENT[species]} 18%, transparent)`,
            borderRadius: lcosTokens.radius.cardSmall,
            boxShadow: lcosTokens.shadow.default,
            padding: 10,
          }}
    >
      <LcosSpeciesBodyContent
        species={species}
        title={title}
        density={density}
        secondary={descriptor?.secondaryLine}
        preview={descriptor?.preview}
        visualFamily={visualFamily}
        mediaSrc={mediaSrc}
        durationSec={durationSec}
        zoom={presentation?.zoom}
        worldWidth={presentation?.worldWidth}
        worldHeight={presentation?.worldHeight}
        sourceRunId={descriptor?.sourceRunId}
        nodeId={input.nodeId}
        projectId={projectId ?? undefined}
        fileRecordId={descriptor?.fileRecordId}
        mimeType={descriptor?.mimeType}
        artifactKind={descriptor?.artifactKind}
        workflowAction={workflowAction}
        workflowDisabled={species === 'workflow-collection' && workflowUnavailableReason !== undefined}
        workflowDisabledReason={workflowUnavailableReason}
        collectionMemberCount={descriptor?.collectionMemberCount}
        collectionMemberLabels={descriptor?.collectionMemberLabels}
        collectionMembers={descriptor?.collectionMembers}
        collectionId={species === 'collection' && ref?.entityType === 'collection' ? ref.entityId : undefined}
        collectionSelected={canvasNodes.some((node) => node.id === input.nodeId && node.selected === true)}
        collectionDragging={canvasNodes.some((node) => node.id === input.nodeId && node.dragging === true)}
        collectionActivationSuppressed={collectionActivationSuppressed} collectionFrameExpanded={collectionFrame !== undefined && !collectionFrameCollapsed}
        collectionFrameDisabledReason={collectionFrameDisabledReason}
        onToggleCollectionFrame={species === 'collection' ? toggleCollectionFrame : undefined}
      />
      <NodeColorPinMarkers nodeId={input.nodeId} />
      <NodeReferenceMarker nodeId={input.nodeId} />
    </div>
  );
}

/**
 * 物种 → body 组件工厂。全应用只有 `lcosNodeCardRegistry` 使用它；
 * 这里不再对外导出一张并行的物种表（R2：单一 junction + 单一注册表）。
 */
export function speciesBodyFor(species: LcosNodeSpecies): ComponentType<CanvasNodeBodySlotInput> {
  return (input) => <LcosSpeciesBody species={species} input={input} />;
}

void NODE_SPECIES_LABEL; // 标签表供未来无障碍/工具提示使用
