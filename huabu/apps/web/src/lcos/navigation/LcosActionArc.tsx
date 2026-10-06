// LcosActionArc — LCOS 节点命令的**节点近场 / 右键**入口（T3-A02，R2 返工）。
//
// 形态（对照 T3-A02「selection/node near-field overlay」）：
//   - 锚在**选中节点**上（flow 坐标 → Huabu `CanvasFloatingPopover` 负责翻转/夹边），
//     不是固定在屏幕右侧的大菜单；
//   - 近场 = **2 个常用动作 + 1 个「更多」**（最终 Figma 三项；T3 上限仍保留）；
//   - 「更多」锚在节点右上近场，只列短动作；尺寸/强调色在相邻二级 inspector 编辑。
//   - Arc 已覆盖类型的右键菜单复用同一命令模型和 dispatch；未覆盖类型保留 Huabu 原生壳。
//
// 纪律：
//   - 命令表来自 web-gen2 的纯函数 `buildLcosNodeCommands`（唯一模型，label 只显示）；
//   - **不适用动作不出现**；暂不可用的动作给真实 reason 并禁用，不再堆「尚未接线（GAP）」；
//   - 只在旧 Huabu 工具条已被本 Arc 覆盖的节点类型上出现（`LCOS_STANDDOWN_TOOLBAR_TYPES`），
//     否则会与仍在挂载的旧工具条重复；
//   - 每个动作都有真实 owner（canvas store / shell store / preview workspace），不写第二套 store。

import {
  colorPinTargetFromEntityRef,
  buildLcosNodeCommands,
  descriptorFor,
  primaryNodeCommands,
  type EntityType,
  type LcosNodeCommand,
} from '@local-creative-os/web-gen2';
import {
  Activity,
  CheckCheck,
  ChevronsUpDown,
  Expand,
  FileText,
  Link2,
  Maximize2,
  MessageSquarePlus,
  MessageSquareReply,
  Move,
  PanelTop,
  Sparkles,
  TextCursorInput,
  Trash2,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { ACCENT_PALETTE } from '@huabu/shared';

import {
  CanvasFloatingPopover,
  type CanvasAnchorRect,
} from '@/components/Common/CanvasFloatingPopover';
import { DropdownMenu, DropdownMenuItem } from '@/components/Common/DropdownMenu';
import { toast } from '@/components/Common/Toast';
import { useHeightMode } from '@/components/Nodes/shared/height/useHeightMode';
import { shouldStandDownLegacyNodeToolbar } from '@/lcos-seam/chromeModeSlot';
import { isNativeAccentSurfaceEnabled, useResolvedNodeHostPresentation } from '@/lcos-seam/nodeBodySlot';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';
import useCanvasStore from '@/store/canvasStore';
import { openPreviewNode } from '@/store/previewWorkspace/actions';

import { ACTION_ARC_HIT_INSET, ACTION_ARC_HIT_SIZE, resolveActionArcGeometry } from './actionArcGeometry';
import { focusConversationSection } from './focusConversationSection';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { draftReferenceUnavailableReason, snapshotDraftReference } from '../composer/referenceSnapshot';
import { portalDropTargetForCanvas, usePortalDropWorkspaceContext } from '../drop/PortalDropWorkspaceContext';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useOptionalLcosColorPins } from '../pin/LcosColorPinProvider';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';
import { LcosActionOrbitMotion, LcosActionArcMotionHost } from '../ui/nearfield/LcosActionOrbitMotion';
import { LcosActionOrbView as ActionArcOrb } from '../ui/nearfield/LcosActionOrbView';
import { LcosNearfieldGlyph } from '../ui/nearfield/LcosNearfieldGlyph';

import type { Node } from '@xyflow/react';

type ArcDropdownTriggerProps = Omit<React.ComponentProps<typeof ActionArcOrb>, 'onClick' | 'expanded'> & {
  readonly onClick?: (event: React.MouseEvent) => void;
  readonly 'aria-expanded'?: boolean;
  readonly expanded?: boolean;
};

/** Adapt the DropdownMenu trigger's controlled props to the existing Figma orb. */
function ArcDropdownTrigger({ onClick, 'aria-expanded': menuExpanded, expanded, ...orbProps }: ArcDropdownTriggerProps): React.JSX.Element {
  return <ActionArcOrb {...orbProps} expanded={menuExpanded ?? expanded} onClick={onClick as unknown as () => void} />;
}

const ARC_GROUPS = ['进入', '关系', '编辑', '外观', '空间'] as const;

interface NodeBox {
  width: number;
  height: number;
}

/** 节点在 flow 坐标系里的可见框（用于锚点）。 */
function flowBoxOf(node: Node): NodeBox {
  const raw = node as unknown as {
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    style?: { width?: number | string; height?: number | string };
  };
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const width =
    num(raw.measured?.width) ?? num(raw.width) ?? num(raw.style?.width) ?? 280;
  const height =
    num(raw.measured?.height) ?? num(raw.height) ?? num(raw.style?.height) ?? 200;
  return { width, height };
}

function primaryCommandIcon(command: LcosNodeCommand): React.JSX.Element {
  switch (command.id) {
    case 'open':
      return <PanelTop size={17} strokeWidth={1.8} aria-hidden />;
    case 'compose':
      return <MessageSquarePlus size={17} strokeWidth={1.8} aria-hidden />;
    case 'answer-input':
      return <MessageSquareReply size={17} strokeWidth={1.8} aria-hidden />;
    case 'review-result':
      return <CheckCheck size={17} strokeWidth={1.8} aria-hidden />;
    case 'view-progress':
      return <Activity size={17} strokeWidth={1.8} aria-hidden />;
    case 'reference':
      return <Link2 size={17} strokeWidth={1.8} aria-hidden />;
    case 'auto-height':
      return <ChevronsUpDown size={17} strokeWidth={1.8} aria-hidden />;
    case 'convert-text':
      return <TextCursorInput size={17} strokeWidth={1.8} aria-hidden />;
    case 'convert-note':
      return <FileText size={17} strokeWidth={1.8} aria-hidden />;
    case 'open-large':
      return <Expand size={17} strokeWidth={1.8} aria-hidden />;
    case 'move-space':
      return <Move size={17} strokeWidth={1.8} aria-hidden />;
    case 'fit':
      return <Maximize2 size={17} strokeWidth={1.8} aria-hidden />;
    case 'delete':
      return <Trash2 size={17} strokeWidth={1.8} aria-hidden />;
    default:
      return <Sparkles size={17} strokeWidth={1.8} aria-hidden />;
  }
}

export function LcosActionArc(): React.JSX.Element | null {
  const portalContext = usePortalDropWorkspaceContext();
  const nodes = useCanvasStore((s) => s.nodes);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const shellProjectId = useLcosShellStore((s) => s.projectId);
  const identitiesReady = useLcosReferenceStore((s) => s.projectId !== null && s.projectId === shellProjectId
    && s.bindingCanvasId === canvasId && s.bindingIdentitiesReady);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [contextNodeId, setContextNodeId] = useState<string | null>(null);
  const [inspector, setInspector] = useState<'size' | 'accent' | null>(null);
  const [sizeDraft, setSizeDraft] = useState<{ width: number; height: number } | null>(null);
  const canvasEngaged = useCanvasAttentionStore((state) => state.isCanvasEngaged);
  const colorPins = useOptionalLcosColorPins();
  const projectId = useLcosReferenceStore((state) => state.projectId);
  const cancelSectionFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelSectionFocus.current?.(), [projectId]);

  // 近场入口只在"恰好选中一个节点"时出现（多选由 MultiSelect 承担），
  // 且该类型的旧工具条已被本 Arc 覆盖 —— 未覆盖类型（pdf/office/web/sketch/question/frame/text）
  // 仍在挂旧工具条，Arc 不出现，避免同一动作两套入口并存。
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const soleSelected = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const commandNode = soleSelected;
  const accentHostPresentation = useResolvedNodeHostPresentation({
    nodeId: commandNode?.id ?? '',
    nodeType: commandNode?.type ?? '',
    data: commandNode?.data ?? {},
  });
  const nativeAccentSurfaceEnabled = isNativeAccentSurfaceEnabled(accentHostPresentation);
  const candidateRef = useLcosReferenceStore((s) =>
    commandNode ? s.nodeEntityRefs.get(commandNode.id) : undefined,
  );
  const node = identitiesReady && commandNode !== undefined && shouldStandDownLegacyNodeToolbar(
    'lcos',
    commandNode.type ?? '',
    candidateRef?.entityType !== undefined && candidateRef.entityId !== undefined,
  ) ? commandNode : undefined;
  const nodeId = node?.id;
  const ref = candidateRef;
  const collaborationEntry = useCollaborationSession(projectId,
    node !== undefined && ref?.entityType === 'conversation' ? ref.entityId : null);
  const conversation = collaborationEntry?.status === 'ready' ? collaborationEntry.projection : undefined;
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  // 高度模式：hook 必须无条件调用（nodeId 缺省时传空串，返回值不参与渲染）。
  const heightMode = useHeightMode(nodeId ?? '');

  // 选择变化即收起"更多"，避免浮层停在旧节点上。
  const onSelectedNodeChanged = useEffectEvent(() => {
    if (contextNodeId && contextNodeId !== nodeId) setContextNodeId(null);
    if (contextNodeId !== nodeId) setMoreOpen(false);
    setInspector(null);
    setSizeDraft(null);
  });
  useEffect(() => { onSelectedNodeChanged(); }, [nodeId]);

  const commands = useMemo<readonly LcosNodeCommand[]>(() => {
    if (!node || !nodeId) return [];
    const data = node.data as Record<string, unknown> | undefined;
    const targetCanvasId = typeof data?.targetCanvasId === 'string' ? data.targetCanvasId : undefined;
    const capabilities =
      ref === undefined
        ? []
        : descriptorFor({
            type: ref.entityType as EntityType,
            id: ref.entityId,
            ...(ref.descriptor?.artifactKind === undefined ? {} : { kind: ref.descriptor.artifactKind }),
            ...(ref.descriptor?.title === undefined ? {} : { title: ref.descriptor.title }),
          }).capabilities;
    const referenced =
      ref !== undefined &&
      draftRefs.some((r) => r.entityType === ref.entityType && r.entityId === ref.entityId);
    return buildLcosNodeCommands({
      nodeType: node.type,
      ...(ref ? { entityType: ref.entityType, entityId: ref.entityId } : {}),
      ...(targetCanvasId ? { targetCanvasId } : {}),
      capabilities: [...capabilities],
      referenced,
      ...(ref?.descriptor?.execution ? { execution: ref.descriptor.execution } : {}),
      ...(conversation === undefined ? {} : { conversation }),
      ...(node.type === 'note' ? { noteHeightMode: heightMode === 'auto' ? 'auto' : 'fixed' } : {}),
    });
  }, [node, nodeId, ref, draftRefs, heightMode, conversation]);

  // Right click opens the existing command model as a local management menu.
  // An open Composer must not consume that independent operation.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      if (!identitiesReady) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"], a[href]')) return;
      if (target.closest('[data-canvas-root]') === null) return;
      const nodeElement = target.closest<HTMLElement>('.react-flow__node[data-id]');
      const targetNodeId = nodeElement?.dataset.id;
      if (targetNodeId === undefined) return;
      const targetNode = nodes.find((candidate) => candidate.id === targetNodeId);
      if (targetNode === undefined) return;
      const targetRef = useLcosReferenceStore.getState().nodeEntityRefs.get(targetNodeId);
      if (!shouldStandDownLegacyNodeToolbar(
        'lcos',
        targetNode.type ?? '',
        targetRef?.entityType !== undefined && targetRef.entityId !== undefined,
      )) return;
      const selection = useCanvasStore.getState().nodes.filter((item) => item.selected);
      // The group toolbar owns a right-click on any selected member.
      if (selection.length > 1 && selection.some((item) => item.id === targetNodeId)) return;
      event.preventDefault();
      setContextNodeId(targetNodeId);
      if (selection.length !== 1 || selection[0]?.id !== targetNodeId) useCanvasStore.getState().selectNodes([targetNodeId]);
      setMoreOpen(true);
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [nodes, identitiesReady]);

  // Canvas attention is the shared visibility owner. Reader/Assembly focus
  // steps the Arc aside; returning focus to the canvas restores it.
  if (!node || !nodeId || (!canvasEngaged && !moreOpen)) return <AnimatePresence />;

  const box = flowBoxOf(node);
  const absolutePosition = useCanvasStore.getState().rfInstance?.getInternalNode(nodeId)?.internals.positionAbsolute ?? node.position;
  const anchor: CanvasAnchorRect = {
    x: absolutePosition.x,
    y: absolutePosition.y,
    width: box.width,
    height: box.height,
  };

  const dispatch = (command: LcosNodeCommand): void => {
    if (command.disabledReason !== undefined) return;
    cancelSectionFocus.current?.();
    const shell = useLcosShellStore.getState();
    const canvas = useCanvasStore.getState();
    const title = (node.data as { label?: string } | undefined)?.label ?? '未命名';
    const data = node.data as Record<string, unknown> | undefined;
    const target = typeof data?.targetCanvasId === 'string' ? data.targetCanvasId : undefined;
    const presentedRevisionId = ref?.descriptor?.presentedRevisionId ?? ref?.descriptor?.currentRevisionId;
    switch (command.id) {
      case 'open':
        if (ref?.entityType === 'run' || ref?.entityType === 'result-slot') {
          const runId = ref.entityType === 'run' ? ref.entityId : ref.descriptor?.execution?.runId;
          if (runId) shell.openWindow('run-review', `任务 · ${ref.descriptor?.title ?? title}`, runId);
        }
        else if (node.type === 'canvasRef' || node.type === 'spacePreview') shell.openWindow('portal-preview', `入口 · ${title}`, target, 'canvas', {workspaceId: ref?.entityType === 'workspace' ? ref.entityId : portalDropTargetForCanvas(portalContext,target)?.workspaceId,sourceNodeId:nodeId});
        else if (ref?.entityType === 'conversation')
          shell.openWindow('conversation', `会话窗口 · ${title}`, ref.entityId);
        else if (ref?.entityType === 'artifact')
          shell.openReader(`阅读 · ${title}`, ref.entityId, {
            ...(presentedRevisionId === undefined ? {} : { revisionId: presentedRevisionId }),
            source: { surface: shell.activeSurface, nodeId },
          });
        break;
      case 'answer-input':
      case 'review-result':
      case 'view-progress':
      case 'recover-session':
      case 'session-diagnostics':
      case 'session-options':
      case 'cancel-work':
        if (ref?.entityType === 'conversation') {
          shell.openWindow('conversation', `会话窗口 · ${title}`, ref.entityId);
          cancelSectionFocus.current = focusConversationSection(ref.entityId, command.id);
        }
        setMoreOpen(false);
        break;
      case 'compose':
        shell.openComposer({
          nodeId,
          title,
          anchor,
          ...(ref?.entityType === 'conversation'
            ? {
                intent: 'continue' as const,
                receiverConversationId: ref.entityId,
              }
            : { intent: 'delegate' as const, targetReferences: ref ? [snapshotDraftReference(ref)] : [] }),
          ...(shell.activeWorkspaceId === null
            ? {}
            : { workspaceId: shell.activeWorkspaceId }),
        });
        setMoreOpen(false);
        break;
      case 'reference':
        if (!useLcosReferenceStore.getState().toggleNodeReference(nodeId, shell.composerTarget?.intent)) {
          toast(draftReferenceUnavailableReason(ref ? snapshotDraftReference(ref) : undefined, shell.composerTarget?.intent) ?? '引用尚未就绪。', { tone: 'danger' });
        }
        break;
      case 'color-pin':
        if (colorPins !== null && ref !== undefined && shell.projectId !== null) {
          colorPins.openAuthoring({
            targetRef: colorPinTargetFromEntityRef(shell.projectId, ref),
            label: ref.descriptor?.title ?? title,
          });
          setMoreOpen(false);
        }
        break;
      case 'auto-height':
        canvas.setNoteHeightMode([nodeId], heightMode === 'auto' ? 'fixed' : 'auto');
        break;
      case 'convert-text':
        canvas.convertNodeType(nodeId, 'text');
        break;
      case 'convert-note':
        canvas.convertNodeType(nodeId, 'note');
        break;
      case 'open-large':
        openPreviewNode(nodeId);
        break;
      case 'move-space':
        canvas.setMoveSelectionDialogOpen(true);
        break;
      case 'fit':
        shell.requestCamera('fit');
        break;
      case 'delete':
        canvas.deleteNodes([nodeId]);
        break;
      default:
        break; // 尺寸/强调色由二级 inspector 写入既有画布呈现字段。
    }
  };

  const applySize = (): void => {
    if (!sizeDraft) return;
    useCanvasStore.getState().setNodeGeometry([
      { nodeId, size: { width: Math.max(80, sizeDraft.width), height: Math.max(60, sizeDraft.height) } },
    ]);
    setSizeDraft(null);
  };

  // Final Figma 5388:311: two common actions plus More. All commands stay in More.
  const visibleCommands = nativeAccentSurfaceEnabled
    ? commands
    : commands.filter((command) => command.id !== 'accent');
  const primary = primaryNodeCommands(visibleCommands).slice(0, 2);
  const commandGroups = ARC_GROUPS.map((group) => ({
    group,
    items: visibleCommands.filter((command) => command.group === group),
  })).filter((entry) => entry.items.length > 0);
  const grouped = commandGroups.map((entry) => ({
    ...entry, items: entry.items.filter((command) => !primary.includes(command)),
  })).filter((entry) => entry.items.length > 0);
  const hasAvailableContinueAction = primary.some((command) => command.id === 'compose');
  const diagnosticsNeeded = collaborationEntry?.status === 'error'
    || conversation?.userState === 'unavailable'
    || (conversation?.recovery?.state !== undefined && conversation.recovery.state !== 'none');
  const menuCommands = grouped.flatMap(({ items }) => items).filter((command) => {
    // Unsupported native document deletion / relocation is not a Core action.
    // Keep the original command guards, without exposing dead choices here.
    if ((command.id === 'delete' || command.id === 'move-space') && command.disabledReason !== undefined) return false;
    // Canvas framing already lives in the spatial navigator / camera island.
    if (command.id === 'fit') return false;
    // Healthy sessions reach diagnostics from Conversation Work View only.
    if (command.id === 'session-diagnostics' && !diagnosticsNeeded) return false;
    // The same Composer exposes continue, new conversation, and branch modes.
    if (command.id === 'session-options' && hasAvailableContinueAction) return false;
    return true;
  });

  const arcGeometry = resolveActionArcGeometry(primary.length + 1);
  const arcPoints = arcGeometry.points;
  const arcMode = arcGeometry.mode;
  const arcWidth = arcGeometry.width;
  const arcHeight = arcGeometry.height;
  const morePoint = arcPoints[primary.length] ?? { x: 0, y: 0 };
  const nearbyControls = { excludeNodeId: nodeId, maxShift: 48,
    hitRects: arcPoints.map((point) => ({ x: point.x - ACTION_ARC_HIT_INSET, y: point.y - ACTION_ARC_HIT_INSET, width: ACTION_ARC_HIT_SIZE, height: ACTION_ARC_HIT_SIZE })) };

  return (
    <AnimatePresence>
      <CanvasFloatingPopover key={nodeId}
        anchor={{ x: anchor.x + anchor.width, y: anchor.y, width: 0, height: 0 }}
        open side="bottom-start" offset={-48} crossAxisOffset={-34}
        style={{ pointerEvents: 'none', zIndex: 30 }} nearbyControls={nearbyControls}>
      <LcosActionArcMotionHost
        data-lcos-action-arc
        data-lcos-arc-node={nodeId}
        data-lcos-arc-mode={arcMode}
        data-figma-node-id="5388:311"
        className="pointer-events-none flex flex-col items-start"
        style={{ maxWidth: 320 }}
      >
        {/* Figma 5388:311：每个动作是独立 30×30 玻璃圆，沿节点近场弧线展开。 */}
        <LcosActionOrbitMotion width={arcWidth} height={arcHeight}>
          {primary.map((command, index) => (
            <ActionArcOrb
              key={command.id}
              actionId={command.id}
              point={arcPoints[index]}
              label={command.label}
              disabledReason={command.disabledReason}
              onClick={() => dispatch(command)}
            >
              {primaryCommandIcon(command)}
            </ActionArcOrb>
          ))}
          <span
            data-lcos-action-arc-menu-anchor
            className="lcos-action-arc-menu-anchor pointer-events-auto"
            style={{ left: morePoint.x - ACTION_ARC_HIT_INSET, top: morePoint.y - ACTION_ARC_HIT_INSET,
              width: ACTION_ARC_HIT_SIZE, height: ACTION_ARC_HIT_SIZE }}
          >
            <DropdownMenu
              open={moreOpen}
              onOpenChange={(open) => {
                setMoreOpen(open);
                setContextNodeId(null);
                if (open) setInspector(null);
              }}
              align="right-top"
              offset={{ x: 8, y: -8 }}
              className="lcos-action-arc-menu overflow-y-auto"
              trigger={
                <ArcDropdownTrigger
                  more
                  buttonRef={moreButtonRef}
                  point={{ x: ACTION_ARC_HIT_INSET, y: ACTION_ARC_HIT_INSET }}
                  label={moreOpen ? '收起更多命令' : '更多命令'}
                  expanded={moreOpen}
                  onClick={() => {}}
                >
                  <LcosNearfieldGlyph name="more" size={17} />
                </ArcDropdownTrigger>
              }
            >
              <div
                data-lcos-arc-panel
                data-lcos-arc-panel-node={nodeId}
                role="menu"
                aria-label={contextNodeId === nodeId ? '节点操作' : '对象更多操作'}
              >
                {menuCommands.map((command) => {
                  const editor = command.id === 'size' || command.id === 'accent'
                    ? command.id
                    : null;
                  return (
                    <DropdownMenuItem
                      key={command.id}
                      data-lcos-command={command.id}
                      aria-haspopup={editor === null ? undefined : 'dialog'}
                      aria-expanded={editor === null ? undefined : inspector === editor}
                      disabled={command.disabledReason !== undefined}
                      title={command.disabledReason}
                      icon={primaryCommandIcon(command)}
                      className="lcos-action-arc-menu-item"
                      onClick={() => {
                        if (editor !== null) {
                          setInspector(editor);
                          setMoreOpen(false);
                          return;
                        }
                        dispatch(command);
                        setMoreOpen(false);
                        setContextNodeId(null);
                        setInspector(null);
                      }}
                    >
                      {command.label}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </DropdownMenu>
          </span>
        </LcosActionOrbitMotion>

      </LcosActionArcMotionHost>
      </CanvasFloatingPopover>
      {inspector !== null && (
        <CanvasFloatingPopover key={`${nodeId}-${inspector}-inspector`}
          onDismiss={() => setInspector(null)} referenceElement={moreButtonRef}
          ariaLabel={inspector === 'size' ? '调整节点尺寸' : '选择节点强调色'}
          anchor={{ x: anchor.x + anchor.width, y: anchor.y, width: 0, height: 0 }}
          open side="right-start" offset={8} crossAxisOffset={-8}
          style={{ zIndex: 31 }} nearbyControls={{ excludeNodeId: nodeId, maxShift: 48 }}>
          <LcosActionArcMotionHost data-lcos-arc-inspector={inspector}
            role="dialog" aria-label={inspector === 'size' ? '调整节点尺寸' : '选择节点强调色'}
            className="pointer-events-auto flex flex-col gap-2"
            style={{ ...lcosGlassStyle, width: inspector === 'accent' ? 208 : 226, padding: 8 }}>
            <div className="flex items-center justify-between gap-2">
              <strong className="text-xs" style={{ color: lcosTokens.color.text }}>{inspector === 'size' ? '尺寸' : '强调色'}</strong>
              <button type="button" aria-label="返回更多命令" onClick={() => { setInspector(null); setMoreOpen(true); }}
                className="min-h-8 rounded px-2 text-[11px]" style={{ color: lcosTokens.color.muted }}>返回</button>
            </div>
            {inspector === 'size' ? (
              <div className="flex items-center gap-1">
                <input data-lcos-size-width type="number" aria-label="宽度"
                  value={sizeDraft?.width ?? Math.round(box.width)}
                  onChange={(e) => setSizeDraft({ width: Number(e.target.value) || 0, height: sizeDraft?.height ?? Math.round(box.height) })}
                  className="w-16 rounded px-2 text-xs" style={{ minHeight: 36, background: lcosTokens.color.raised, color: lcosTokens.color.text }} />
                <span style={{ color: lcosTokens.color.muted }}>×</span>
                <input data-lcos-size-height type="number" aria-label="高度"
                  value={sizeDraft?.height ?? Math.round(box.height)}
                  onChange={(e) => setSizeDraft({ width: sizeDraft?.width ?? Math.round(box.width), height: Number(e.target.value) || 0 })}
                  className="w-16 rounded px-2 text-xs" style={{ minHeight: 36, background: lcosTokens.color.raised, color: lcosTokens.color.text }} />
                <button type="button" data-lcos-size-apply disabled={sizeDraft === null} onClick={applySize}
                  className="min-h-9 rounded px-2 text-[11px]" style={{ color: lcosTokens.color.text }}>应用</button>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1">
                {ACCENT_PALETTE.map((entry) => <button key={entry.token} type="button" data-lcos-accent={entry.token}
                  aria-label={`强调色 ${entry.name}`} title={entry.name}
                  onClick={() => useCanvasStore.getState().updateNodeData(nodeId, {
                    style: { ...((node.data as { style?: object }).style ?? {}), accent: entry.token },
                  })}
                  className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: lcosTokens.color.raised }}>
                  <span className="h-4 w-4 rounded-full" style={{ background: entry.value, border: `1px solid ${lcosTokens.color.borderSubtle}` }} />
                </button>)}
                <button type="button" data-lcos-accent-clear aria-label="清除强调色"
                  onClick={() => useCanvasStore.getState().updateNodeData(nodeId, {
                    style: { ...((node.data as { style?: object }).style ?? {}), accent: null },
                  })}
                  className="h-9 rounded px-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>清除</button>
              </div>
            )}
          </LcosActionArcMotionHost>
        </CanvasFloatingPopover>
      )}
    </AnimatePresence>
  );
}
