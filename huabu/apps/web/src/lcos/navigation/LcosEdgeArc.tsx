// LcosEdgeArc — LCOS 的**边**命令入口（节点近场/边中点浮层，R2 返工）。
//
// 目的：让旧 `EdgeStyleToolbar` 能在 chromeMode="lcos" 下停止挂载而不丢能力。
// 覆盖范围与旧工具条一一对应（同一 owner、同一机械，不写第二套 store）：
//   线型 lineType(bezier/straight/step) · 线样式 lineStyle(solid/dashed/dotted) ·
//   方向 direction(none/forward/backward/both) · 线宽 strokeWidth · 颜色 stroke · 断开
// 写入统一走 `useCanvasStore.executeCommands([{type:'SET_EDGE_STYLE', ...}])`，
// 断开走 `disconnectEdges`（与旧工具条完全相同的命令路径）。

import { useMemo } from 'react';

import { ACCENT_PALETTE, EDGE_STROKE_WIDTHS } from '@huabu/shared';

import { CanvasFloatingPopover } from '@/components/Common/CanvasFloatingPopover';
import useCanvasStore from '@/store/canvasStore';

import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { CanvasAnchorRect } from '@/components/Common/CanvasFloatingPopover';
import type {
  CanvasEdgeId,
  EdgeDirection,
  EdgeLineStyle,
  EdgeLineType,
  EdgeStrokeWidth,
  EdgeStyle,
} from '@huabu/shared';

const LINE_TYPES: readonly { value: EdgeLineType; label: string }[] = [
  { value: 'bezier', label: '曲线' },
  { value: 'straight', label: '直线' },
  { value: 'step', label: '折线' },
];

const LINE_STYLES: readonly { value: EdgeLineStyle; label: string }[] = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

const DIRECTIONS: readonly { value: EdgeDirection; label: string }[] = [
  { value: 'none', label: '无向' },
  { value: 'forward', label: '正向' },
  { value: 'backward', label: '反向' },
  { value: 'both', label: '双向' },
];

/** 边中点的 flow 坐标：直接读 ReactFlow 渲染出来的 path（与旧工具条同一做法）。 */
function useEdgeMidpoint(edgeId: string | undefined): CanvasAnchorRect | null {
  return useMemo(() => {
    if (!edgeId) return null;
    const pathEl = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${CSS.escape(edgeId)}"] path`,
    );
    if (!pathEl) return null;
    const point = pathEl.getPointAtLength(pathEl.getTotalLength() / 2);
    const matrix = pathEl.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const container = document.querySelector('.react-flow')?.getBoundingClientRect();
    const rfViewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    const transform = rfViewport?.style.transform ?? '';
    const zoom = Number(/scale\(([^)]+)\)/.exec(transform)?.[1] ?? '1');
    const tx = Number(/translate\(([^,]+)px/.exec(transform)?.[1] ?? '0');
    const ty = Number(/,\s*([^)]+)px\)/.exec(transform)?.[1] ?? '0');
    const left = container?.left ?? 0;
    const top = container?.top ?? 0;
    const scale = zoom === 0 ? 1 : zoom;
    return {
      x: (screen.x - left - tx) / scale,
      y: (screen.y - top - ty) / scale,
      width: 0,
      height: 0,
    };
  }, [edgeId]);
}

export function LcosEdgeArc(): React.JSX.Element | null {
  const edges = useCanvasStore((s) => s.edges);
  const executeCommands = useCanvasStore((s) => s.executeCommands);
  const disconnectEdges = useCanvasStore((s) => s.disconnectEdges);

  const selected = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const edge = selected.length === 1 ? selected[0] : undefined;
  const anchor = useEdgeMidpoint(edge?.id);

  if (!edge || !anchor) return null;

  const style = ((edge.data as { edgeStyle?: EdgeStyle } | undefined)?.edgeStyle ?? {}) as EdgeStyle;
  const setStyle = (patch: Partial<EdgeStyle>): void => {
    executeCommands([{ type: 'SET_EDGE_STYLE', edges: [{ edge: edge.id as CanvasEdgeId, style: patch }] }]);
  };

  const rowStyle = { minHeight: 28, color: lcosTokens.color.text } as const;
  const activeStyle = { background: lcosTokens.color.raised } as const;

  return (
    <CanvasFloatingPopover anchor={anchor} open side="top" offset={10}>
      <div
        data-lcos-edge-arc
        data-lcos-edge-arc-edge={edge.id}
        className="pointer-events-auto flex flex-col gap-1"
        style={{ ...lcosGlassStyle, padding: 6 }}
      >
        <div className="flex items-center gap-1" data-lcos-edge-group="lineType">
          {LINE_TYPES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-lcos-edge-linetype={option.value}
              onClick={() => setStyle({ lineType: option.value })}
              className="rounded-full px-2 text-[11px]"
              style={{ ...rowStyle, ...((style.lineType ?? 'bezier') === option.value ? activeStyle : {}) }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" data-lcos-edge-group="lineStyle">
          {LINE_STYLES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-lcos-edge-linestyle={option.value}
              onClick={() => setStyle({ lineStyle: option.value })}
              className="rounded-full px-2 text-[11px]"
              style={{ ...rowStyle, ...((style.lineStyle ?? 'solid') === option.value ? activeStyle : {}) }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" data-lcos-edge-group="direction">
          {DIRECTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-lcos-edge-direction={option.value}
              onClick={() => setStyle({ direction: option.value })}
              className="rounded-full px-2 text-[11px]"
              style={{ ...rowStyle, ...((style.direction ?? 'none') === option.value ? activeStyle : {}) }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" data-lcos-edge-group="strokeWidth">
          {EDGE_STROKE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              data-lcos-edge-width={width}
              onClick={() => setStyle({ strokeWidth: width as EdgeStrokeWidth })}
              className="rounded-full px-2 text-[11px]"
              style={{ ...rowStyle, ...(style.strokeWidth === width ? activeStyle : {}) }}
            >
              {width}px
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" data-lcos-edge-group="stroke">
          {ACCENT_PALETTE.map((entry) => (
            <button
              key={entry.token}
              type="button"
              data-lcos-edge-color={entry.token}
              aria-label={`线色 ${entry.name}`}
              title={entry.name}
              // 与旧 EdgeStyleToolbar 一致：写的是调色板 token，不是 hex。
              onClick={() => setStyle({ stroke: entry.token })}
              className="h-4 w-4 rounded-full"
              style={{ background: entry.value, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
            />
          ))}
          <button
            type="button"
            data-lcos-edge-disconnect
            onClick={() => disconnectEdges([edge.id])}
            className="ml-1 rounded-full px-2 text-[11px]"
            style={{ ...rowStyle, color: lcosTokens.color.danger }}
          >
            断开
          </button>
        </div>
      </div>
    </CanvasFloatingPopover>
  );
}
