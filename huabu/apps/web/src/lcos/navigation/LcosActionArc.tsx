// LcosActionArc — LCOS 节点命令的**节点近场**入口（T3-A02，R2 返工）。
//
// 形态（对照 T3-A02「selection/node near-field overlay」）：
//   - 锚在**选中节点**上（flow 坐标 → Huabu `CanvasFloatingPopover` 负责翻转/夹边），
//     不是固定在屏幕右侧的大菜单；
//   - 近场一排 = **3 个常规动作 + 1 个「更多」**（T3-A02: 3 normal / 4 max）；
//   - 「更多」在同一条近场浮层里展开分组面板（尺寸/外观/空间），不换位置。
//
// 纪律：
//   - 命令表来自 web-gen2 的纯函数 `buildLcosNodeCommands`（唯一模型，label 只显示）；
//   - **不适用动作不出现**；暂不可用的动作给真实 reason 并禁用，不再堆「尚未接线（GAP）」；
//   - 只在旧 Huabu 工具条已被本 Arc 覆盖的节点类型上出现（`LCOS_STANDDOWN_TOOLBAR_TYPES`），
//     否则会与仍在挂载的旧工具条重复；
//   - 每个动作都有真实 owner（canvas store / shell store / preview workspace），不写第二套 store。

import { buildLcosNodeCommands, descriptorFor, primaryNodeCommands } from '@local-creative-os/web-gen2';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ACCENT_PALETTE } from '@huabu/shared';


import { CanvasFloatingPopover } from '@/components/Common/CanvasFloatingPopover';
import { useHeightMode } from '@/components/Nodes/shared/height/useHeightMode';
import { LCOS_STANDDOWN_TOOLBAR_TYPES } from '@/lcos-seam/chromeModeSlot';
import useCanvasStore from '@/store/canvasStore';
import { openPreviewNode } from '@/store/previewWorkspace/actions';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';


import type { CanvasAnchorRect } from '@/components/Common/CanvasFloatingPopover';
import type { LcosNodeCommand } from '@local-creative-os/web-gen2';
import type { EntityType } from '@local-creative-os/web-gen2';
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

export function LcosActionArc(): React.JSX.Element | null {
  const nodes = useCanvasStore((s) => s.nodes);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<{ width: number; height: number } | null>(null);

  // 近场入口只在"恰好选中一个节点"时出现（多选由 MultiSelect 承担），
  // 且该类型的旧工具条已被本 Arc 覆盖 —— 未覆盖类型（pdf/office/web/sketch/question/frame/text）
  // 仍在挂旧工具条，Arc 不出现，避免同一动作两套入口并存。
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const soleSelected = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const node =
    soleSelected !== undefined && LCOS_STANDDOWN_TOOLBAR_TYPES.has(soleSelected.type ?? '')
      ? soleSelected
      : undefined;
  const nodeId = node?.id;
  const ref = useLcosReferenceStore((s) => (nodeId ? s.nodeEntityRefs.get(nodeId) : undefined));
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

  if (!node || !nodeId) return null;

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
        if (node.type === 'canvasRef') shell.openWindow('portal-preview', `入口 · ${title}`, target);
        else if (ref?.entityType === 'conversation')
          shell.openWindow('conversation', `工作台 · ${title}`, ref.entityId);
        else if (ref?.entityType === 'artifact')
          shell.openWindow('reader', `阅读 · ${title}`, ref.entityId);
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

  return (
    <CanvasFloatingPopover anchor={anchor} open side="top" offset={10}>
      <div
        data-lcos-action-arc
        data-lcos-arc-node={nodeId}
        className="pointer-events-auto flex flex-col gap-2"
        style={{ ...lcosGlassStyle, padding: 6, maxWidth: 320 }}
      >
        {/* 近场一排：3 个常规动作 + 更多 */}
        <div className="flex items-center gap-1">
          {primary.map((command) => (
            <button
              key={command.id}
              type="button"
              data-lcos-arc-primary={command.id}
              title={command.label}
              aria-label={command.label}
              onClick={() => dispatch(command)}
              className="rounded-full px-2.5 text-[11px] font-medium"
              style={{ minHeight: 32, color: lcosTokens.color.text }}
            >
              {command.label}
            </button>
          ))}
          <button
            type="button"
            data-lcos-arc-more
            aria-expanded={moreOpen}
            title="更多命令"
            onClick={() => setMoreOpen((v) => !v)}
            className="ml-1 flex items-center justify-center rounded-full px-2.5 text-[11px] font-medium"
            style={{
              minHeight: 32,
              background: lcosTokens.color.raised,
              color: lcosTokens.color.text,
            }}
          >
            {moreOpen ? <X className="h-3.5 w-3.5" /> : '更多'}
          </button>
        </div>

        {moreOpen && (
          <div data-lcos-arc-panel className="flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
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
  );
}
