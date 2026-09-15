// LcosActionArc — LCOS 节点命令的**节点近场 / 右键**入口（T3-A02，R2 返工）。
//
// 形态（对照 T3-A02「selection/node near-field overlay」）：
//   - 锚在**选中节点**上（flow 坐标 → Huabu `CanvasFloatingPopover` 负责翻转/夹边），
//     不是固定在屏幕右侧的大菜单；
//   - 近场一排 = **3 个常规动作 + 1 个「更多」**（T3-A02: 3 normal / 4 max）；
//   - 「更多」在同一条近场浮层里展开分组面板（尺寸/外观/空间），不换位置。
//   - Arc 已覆盖类型的右键菜单复用同一命令模型和 dispatch；未覆盖类型保留 Huabu 原生壳。
//
// 纪律：
//   - 命令表来自 web-gen2 的纯函数 `buildLcosNodeCommands`（唯一模型，label 只显示）；
//   - **不适用动作不出现**；暂不可用的动作给真实 reason 并禁用，不再堆「尚未接线（GAP）」；
//   - 只在旧 Huabu 工具条已被本 Arc 覆盖的节点类型上出现（`LCOS_STANDDOWN_TOOLBAR_TYPES`），
//     否则会与仍在挂载的旧工具条重复；
//   - 每个动作都有真实 owner（canvas store / shell store / preview workspace），不写第二套 store。

import {
  buildLcosNodeCommands,
  descriptorFor,
  primaryNodeCommands,
  type EntityType,
  type LcosNodeCommand,
} from '@local-creative-os/web-gen2';
import {
  ChevronsUpDown,
  Ellipsis,
  Expand,
  FileText,
  Link2,
  Maximize2,
  MessageSquarePlus,
  Move,
  Sparkles,
  TextCursorInput,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ACCENT_PALETTE } from '@huabu/shared';

import {
  CanvasFloatingPopover,
  type CanvasAnchorRect,
} from '@/components/Common/CanvasFloatingPopover';
import { useHeightMode } from '@/components/Nodes/shared/height/useHeightMode';
import { shouldStandDownLegacyNodeToolbar } from '@/lcos-seam/chromeModeSlot';
import useCanvasStore from '@/store/canvasStore';
import { openPreviewNode } from '@/store/previewWorkspace/actions';

import {
  ACTION_ARC_HIT_INSET,
  ACTION_ARC_HIT_SIZE,
  ACTION_ARC_VISUAL_SIZE,
  resolveActionArcGeometry,
  type ActionArcPoint,
} from './actionArcGeometry';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { Node } from '@xyflow/react';

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
      return <Sparkles size={17} strokeWidth={1.8} aria-hidden />;
    case 'compose':
      return <MessageSquarePlus size={17} strokeWidth={1.8} aria-hidden />;
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

function ActionArcOrb({
  point,
  label,
  disabledReason,
  expanded,
  onClick,
  children,
}: {
  readonly point: ActionArcPoint;
  readonly label: string;
  readonly disabledReason?: string;
  readonly expanded?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const disabled = disabledReason !== undefined;
  return (
    <button
      type="button"
      data-lcos-action-orb-hit
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      title={disabledReason ?? label}
      onClick={onClick}
      className="grid place-items-center rounded-full bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        position: 'absolute',
        left: point.x - ACTION_ARC_HIT_INSET,
        top: point.y - ACTION_ARC_HIT_INSET,
        width: ACTION_ARC_HIT_SIZE,
        height: ACTION_ARC_HIT_SIZE,
        outlineColor: lcosTokens.color.accent,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        data-lcos-action-orb
        style={{
          display: 'grid',
          placeItems: 'center',
          width: ACTION_ARC_VISUAL_SIZE,
          height: ACTION_ARC_VISUAL_SIZE,
          borderRadius: 15,
          background: lcosTokens.actionOrb.background,
          border: `0.6px solid ${lcosTokens.actionOrb.border}`,
          boxShadow: lcosTokens.actionOrb.shadow,
          color: disabled ? lcosTokens.color.muted : lcosTokens.color.text,
          opacity: disabled ? 0.48 : 1,
          transform: expanded ? 'scale(0.96)' : undefined,
          transition: 'transform 120ms ease, opacity 120ms ease',
        }}
      >
        {children}
      </span>
    </button>
  );
}

export function LcosActionArc(): React.JSX.Element | null {
  const nodes = useCanvasStore((s) => s.nodes);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<{ width: number; height: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const composerOpen = useLcosShellStore((state) => state.composerOpen);
  const professionalWindowOpen = useLcosShellStore((state) => state.windows.length > 0);

  // 近场入口只在"恰好选中一个节点"时出现（多选由 MultiSelect 承担），
  // 且该类型的旧工具条已被本 Arc 覆盖 —— 未覆盖类型（pdf/office/web/sketch/question/frame/text）
  // 仍在挂旧工具条，Arc 不出现，避免同一动作两套入口并存。
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const soleSelected = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const contextNode = contextMenu === null
    ? undefined
    : nodes.find((candidate) => candidate.id === contextMenu.nodeId);
  const commandNode = contextNode ?? soleSelected;
  const candidateRef = useLcosReferenceStore((s) =>
    commandNode ? s.nodeEntityRefs.get(commandNode.id) : undefined,
  );
  const node = commandNode !== undefined && shouldStandDownLegacyNodeToolbar(
    'lcos',
    commandNode.type ?? '',
    candidateRef?.entityType !== undefined && candidateRef.entityId !== undefined,
  ) ? commandNode : undefined;
  const nodeId = node?.id;
  const ref = candidateRef;
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  // 高度模式：hook 必须无条件调用（nodeId 缺省时传空串，返回值不参与渲染）。
  const heightMode = useHeightMode(nodeId ?? '');

  // 选择变化即收起"更多"，避免浮层停在旧节点上。
  useEffect(() => {
    setMoreOpen(false);
    setSizeDraft(null);
  }, [nodeId]);

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
      ...(node.type === 'note' ? { noteHeightMode: heightMode === 'auto' ? 'auto' : 'fixed' } : {}),
    });
  }, [node, nodeId, ref, draftRefs, heightMode]);

  // Canvas.tsx suppresses the browser menu in LCOS mode. Reopen it only for
  // node types whose LCOS Arc already owns the corresponding commands, so
  // right-click and the near-field Arc share one command model and dispatch.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      if (composerOpen || professionalWindowOpen) return;
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
      event.preventDefault();
      useCanvasStore.getState().selectNodes([targetNodeId]);
      setMoreOpen(false);
      setContextMenu({ nodeId: targetNodeId, x: event.clientX, y: event.clientY });
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [composerOpen, nodes, professionalWindowOpen]);

  useEffect(() => {
    if (contextMenu === null) return;
    const close = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-lcos-context-menu]') !== null) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (contextMenu !== null && (node === undefined || commands.length === 0)) {
      setContextMenu(null);
    }
  }, [commands.length, contextMenu, node]);

  // Professional Window owns the foreground interaction; keep the node Arc out
  // of the reader, Assembly, portal, and conversation work view.
  if (!node || !nodeId || composerOpen || professionalWindowOpen) return null;

  const box = flowBoxOf(node);
  const anchor: CanvasAnchorRect = {
    x: node.position.x,
    y: node.position.y,
    width: box.width,
    height: box.height,
  };

  const dispatch = (command: LcosNodeCommand): void => {
    const shell = useLcosShellStore.getState();
    const canvas = useCanvasStore.getState();
    const title = (node.data as { label?: string } | undefined)?.label ?? '未命名';
    const data = node.data as Record<string, unknown> | undefined;
    const target = typeof data?.targetCanvasId === 'string' ? data.targetCanvasId : undefined;
    switch (command.id) {
      case 'open':
        if (node.type === 'canvasRef') shell.openWindow('portal-preview', `入口 · ${title}`, target, 'canvas');
        else if (ref?.entityType === 'conversation')
          shell.openWindow('conversation', `工作台 · ${title}`, ref.entityId);
        else if (ref?.entityType === 'artifact')
          shell.openWindow('reader', `阅读 · ${title}`, ref.entityId);
        break;
      case 'compose':
        shell.openComposer({
          nodeId,
          title,
          anchor,
          ...(shell.activeWorkspaceId === null
            ? {}
            : { workspaceId: shell.activeWorkspaceId }),
        });
        setMoreOpen(false);
        break;
      case 'reference':
        useLcosReferenceStore.getState().toggleNodeReference(nodeId);
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
        break; // size/accent 由面板内联控件处理（不是 dispatch 型命令）
    }
  };

  const applySize = (): void => {
    if (!sizeDraft) return;
    useCanvasStore.getState().setNodeGeometry([
      { nodeId, size: { width: Math.max(80, sizeDraft.width), height: Math.max(60, sizeDraft.height) } },
    ]);
    setSizeDraft(null);
  };

  const primary = primaryNodeCommands(commands);
  const grouped = ARC_GROUPS.map((group) => ({
    group,
    items: commands.filter((command) => command.group === group).filter((c) => !primary.includes(c)),
  })).filter((entry) => entry.items.length > 0);

  const contextMenuView = contextMenu !== null && node !== undefined && nodeId !== undefined
    ? (
      <div
        data-lcos-context-menu
        role="menu"
        aria-label="节点命令"
        className="pointer-events-auto fixed z-[70] flex max-h-[60vh] w-64 max-w-[calc(100vw-24px)] flex-col gap-1 overflow-y-auto rounded-2xl p-2"
        style={{
          ...lcosGlassStyle,
          left: Math.min(contextMenu.x, Math.max(12, window.innerWidth - 268)),
          top: Math.min(contextMenu.y, Math.max(12, window.innerHeight - 360)),
        }}
      >
        <span className="px-2 py-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
          {((node.data as { label?: string } | undefined)?.label ?? '节点')} · 命令
        </span>
        {grouped.map(({ group, items }) => (
          <div key={group} data-lcos-context-command-group={group} className="flex flex-col gap-0.5">
            <span className="px-2 pt-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>{group}</span>
            {items.map((command) => (
              <button
                key={command.id}
                type="button"
                role="menuitem"
                data-lcos-context-command={command.id}
                disabled={command.disabledReason !== undefined}
                title={command.disabledReason ?? command.label}
                onClick={() => {
                  if (command.id === 'size' || command.id === 'accent') {
                    setContextMenu(null);
                    setMoreOpen(true);
                    return;
                  }
                  dispatch(command);
                  setContextMenu(null);
                }}
                className="flex min-h-8 flex-col items-start rounded-xl px-2 py-1 text-left text-[11px] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: lcosTokens.color.text }}
              >
                <span className="font-medium">{command.label}</span>
                {command.disabledReason && (
                  <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
                    {command.disabledReason}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    )
    : null;

  const arcGeometry = resolveActionArcGeometry(primary.length + 1);
  const arcPoints = arcGeometry.points;
  const arcMode = arcGeometry.mode;
  const arcWidth = arcGeometry.width;
  const arcHeight = arcGeometry.height;

  return (
    <>
      {contextMenuView}
      {contextMenu === null && (
      <CanvasFloatingPopover anchor={anchor} open side="top" offset={10}>
      <div
        data-lcos-action-arc
        data-lcos-arc-node={nodeId}
        data-lcos-arc-mode={arcMode}
        data-figma-node-id="5388:311"
        className="pointer-events-auto flex flex-col items-start gap-2"
        style={{ maxWidth: 320 }}
      >
        {/* Figma 5388:311：每个动作是独立 30×30 玻璃圆，沿节点近场弧线展开。 */}
        <div
          data-lcos-action-arc-orbit
          className="relative"
          style={{ width: arcWidth, height: arcHeight }}
        >
          {primary.map((command, index) => (
            <ActionArcOrb
              key={command.id}
              point={arcPoints[index]}
              label={command.label}
              disabledReason={command.disabledReason}
              onClick={() => dispatch(command)}
            >
              <span data-lcos-arc-primary={command.id}>{primaryCommandIcon(command)}</span>
            </ActionArcOrb>
          ))}
          <ActionArcOrb
            point={arcPoints[primary.length]}
            label={moreOpen ? '收起更多命令' : '更多命令'}
            expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span data-lcos-arc-more>
              <Ellipsis size={17} strokeWidth={1.8} aria-hidden />
            </span>
          </ActionArcOrb>
        </div>

        {moreOpen && (
          <div
            data-lcos-arc-panel
            className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto"
            style={{
              ...lcosGlassStyle,
              width: 280,
              maxWidth: 'min(320px, 78vw)',
              padding: 6,
            }}
          >
            {grouped.map(({ group, items }) => (
              <div key={group} data-lcos-command-group={group} className="flex flex-col gap-0.5">
                <span className="px-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                  {group}
                </span>
                {items.map((command) => {
                  if (command.id === 'size') {
                    return (
                      <div key={command.id} data-lcos-command="size" className="flex items-center gap-1 px-1 py-0.5">
                        <span className="text-[11px]" style={{ color: lcosTokens.color.text }}>
                          尺寸
                        </span>
                        <input
                          data-lcos-size-width
                          type="number"
                          aria-label="宽度"
                          value={sizeDraft?.width ?? Math.round(box.width)}
                          onChange={(e) =>
                            setSizeDraft({
                              width: Number(e.target.value) || 0,
                              height: sizeDraft?.height ?? Math.round(box.height),
                            })
                          }
                          className="w-14 rounded px-1 text-[11px]"
                          style={{ minHeight: 28, background: lcosTokens.color.raised, color: lcosTokens.color.text }}
                        />
                        <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
                          ×
                        </span>
                        <input
                          data-lcos-size-height
                          type="number"
                          aria-label="高度"
                          value={sizeDraft?.height ?? Math.round(box.height)}
                          onChange={(e) =>
                            setSizeDraft({
                              width: sizeDraft?.width ?? Math.round(box.width),
                              height: Number(e.target.value) || 0,
                            })
                          }
                          className="w-14 rounded px-1 text-[11px]"
                          style={{ minHeight: 28, background: lcosTokens.color.raised, color: lcosTokens.color.text }}
                        />
                        <button
                          type="button"
                          data-lcos-size-apply
                          disabled={sizeDraft === null}
                          onClick={applySize}
                          className="rounded px-2 text-[11px]"
                          style={{ minHeight: 28, color: lcosTokens.color.text }}
                        >
                          应用
                        </button>
                      </div>
                    );
                  }
                  if (command.id === 'accent') {
                    return (
                      <div key={command.id} data-lcos-command="accent" className="flex items-center gap-1 px-1 py-0.5">
                        <span className="text-[11px]" style={{ color: lcosTokens.color.text }}>
                          强调色
                        </span>
                        {ACCENT_PALETTE.map((entry) => (
                          <button
                            key={entry.token}
                            type="button"
                            data-lcos-accent={entry.token}
                            aria-label={`强调色 ${entry.name}`}
                            title={entry.name}
                            onClick={() =>
                              useCanvasStore.getState().updateNodeData(nodeId, {
                                // 存储的是**调色板 token**（主题跟随），不是 hex。
                                style: { ...((node.data as { style?: object }).style ?? {}), accent: entry.token },
                              })
                            }
                            className="h-4 w-4 rounded-full"
                            style={{ background: entry.value, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
                          />
                        ))}
                        <button
                          type="button"
                          data-lcos-accent-clear
                          aria-label="清除强调色"
                          onClick={() =>
                            useCanvasStore.getState().updateNodeData(nodeId, {
                              style: { ...((node.data as { style?: object }).style ?? {}), accent: null },
                            })
                          }
                          className="rounded px-1 text-[10px]"
                          style={{ color: lcosTokens.color.muted }}
                        >
                          清除
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={command.id}
                      type="button"
                      data-lcos-command={command.id}
                      disabled={command.disabledReason !== undefined}
                      title={command.disabledReason}
                      onClick={() => {
                        dispatch(command);
                        setMoreOpen(false);
                      }}
                      className="flex flex-col items-start rounded-lg px-2 py-1 text-left text-[11px]"
                      style={{
                        minHeight: 30,
                        color: command.disabledReason ? lcosTokens.color.muted : lcosTokens.color.text,
                        cursor: command.disabledReason ? 'not-allowed' : 'pointer',
                        opacity: command.disabledReason ? 0.6 : 1,
                      }}
                    >
                      <span className="font-medium">{command.label}</span>
                      {command.disabledReason && (
                        <span data-lcos-command-reason className="text-[10px]">
                          {command.disabledReason}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      </CanvasFloatingPopover>
      )}
    </>
  );
}
