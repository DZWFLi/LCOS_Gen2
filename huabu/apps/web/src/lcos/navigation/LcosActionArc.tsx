// LcosActionArc — LCOS 节点命令菜单（T3，R2）：画布内**唯一**的节点命令入口。
//
// 触发：在节点上右键（contextmenu）。菜单锚在指针处；Esc / 点击别处关闭。
// 命令表来自纯函数 `buildLcosNodeCommands`（真实事实 → 命令 + 不可用原因）。
//
// 边界（本轮诚实声明）：旧 `NodeFloatingToolbar` 的"显示/动作"两组（文本格式、
// sketch 笔刷、frame 布局、AI 运行…）尚未在 LCOS 侧接线，因此在菜单里按 GAP 标注，
// 旧工具条**本轮不退役**（删呈现=删逻辑是红线）。退役条件与剩余清单见 handoff。

import { useEffect, useMemo, useState } from 'react';

import useCanvasStore from '@/store/canvasStore';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { buildLcosNodeCommands, type LcosNodeCommand } from './lcosNodeCommands';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

interface OpenArc {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

/** 从事件目标回溯 ReactFlow 节点的 data-id（Huabu 用 RF 的标准标记）。 */
function nodeIdFromEventTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const nodeEl = target.closest('.react-flow__node');
  if (!(nodeEl instanceof HTMLElement)) return undefined;
  return nodeEl.dataset.id;
}

export function LcosActionArc(): React.JSX.Element | null {
  const [arc, setArc] = useState<OpenArc | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);

  const node = useMemo(
    () => (arc ? nodes.find((n) => n.id === arc.nodeId) : undefined),
    [arc, nodes],
  );
  const ref = useLcosReferenceStore((s) => (arc ? s.nodeEntityRefs.get(arc.nodeId) : undefined));

  // 右键打开（只在命中原生节点时接管，否则保留浏览器菜单）。
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      const nodeId = nodeIdFromEventTarget(event.target);
      if (nodeId === undefined) return;
      event.preventDefault();
      setArc({ nodeId, x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setArc(null);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-lcos-action-arc]') === null) setArc(null);
    };
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown, true);
    };
  }, []);

  const commands = useMemo(() => {
    if (!arc || !node) return [];
    const data = node.data as Record<string, unknown> | undefined;
    const targetCanvasId = typeof data?.targetCanvasId === 'string' ? data.targetCanvasId : undefined;
    const referenced =
      ref !== undefined && draftRefs.some((r) => r.entityType === ref.entityType && r.entityId === ref.entityId);
    return buildLcosNodeCommands({
      nodeType: node.type,
      ...(ref ? { entityType: ref.entityType, entityId: ref.entityId } : {}),
      ...(targetCanvasId ? { targetCanvasId } : {}),
      referenced,
    });
  }, [arc, node, ref, draftRefs]);

  if (!arc || !node) return null;

  const run = (command: LcosNodeCommand): void => {
    const nodeId = arc.nodeId;
    const shell = useLcosShellStore.getState();
    const canvas = useCanvasStore.getState();
    switch (command.id) {
      case 'open': {
        if (node.type === 'canvasRef') {
          const data = node.data as Record<string, unknown> | undefined;
          const target = typeof data?.targetCanvasId === 'string' ? data.targetCanvasId : undefined;
          const title = typeof data?.label === 'string' ? data.label : '入口';
          shell.openWindow('portal-preview', `入口 · ${title}`, target);
          break;
        }
        if (ref?.entityType === 'conversation') {
          const title = (node.data as { label?: string } | undefined)?.label ?? '会话';
          shell.openWindow('conversation', `工作台 · ${title}`, ref.entityId);
          break;
        }
        if (ref?.entityType === 'artifact') {
          const title = (node.data as { label?: string } | undefined)?.label ?? '材料';
          shell.openWindow('reader', `阅读 · ${title}`, ref.entityId);
        }
        break;
      }
      case 'reference':
        useLcosReferenceStore.getState().toggleNodeReference(nodeId);
        break;
      case 'convert-text':
        canvas.convertNodeType(nodeId, 'text');
        break;
      case 'convert-note':
        canvas.convertNodeType(nodeId, 'note');
        break;
      case 'delete':
        canvas.deleteNodes([nodeId]);
        break;
      case 'fit':
        shell.requestCamera('fit');
        break;
      default:
        break; // GAP 命令已被禁用，不会走到这里
    }
    setArc(null);
  };

  const groups = ['进入', '关系', '编辑', '视图', '未接线'] as const;

  // 锚点：指针在屏幕下半区时改成"贴底对齐"，避免长菜单被视口裁掉。
  const placeBelow = arc.y < window.innerHeight / 2;
  const placement = placeBelow
    ? { top: Math.max(8, Math.min(arc.y, window.innerHeight - 8)) }
    : { bottom: Math.max(8, window.innerHeight - arc.y) };

  return (
    <div
      data-lcos-action-arc
      role="menu"
      aria-label="节点命令"
      className="pointer-events-auto fixed z-50 flex w-[248px] flex-col gap-1 p-2"
      style={{
        ...lcosGlassStyle,
        left: Math.min(arc.x, Math.max(8, window.innerWidth - 268)),
        ...placement,
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
      }}
    >
      {groups.map((group) => {
        const items = commands.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} data-lcos-action-group={group} className="flex flex-col gap-0.5">
            <span className="px-2 pt-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
              {group}
            </span>
            {items.map((command) => (
              <button
                key={command.id}
                type="button"
                role="menuitem"
                data-lcos-command={command.id}
                disabled={command.disabledReason !== undefined}
                title={command.disabledReason}
                onClick={() => run(command)}
                className="flex flex-col items-start rounded-lg px-2 py-1.5 text-left text-xs"
                style={{
                  color: command.disabledReason ? lcosTokens.color.muted : lcosTokens.color.text,
                  minHeight: 32,
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
            ))}
          </div>
        );
      })}
    </div>
  );
}
