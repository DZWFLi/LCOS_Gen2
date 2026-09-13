// LcosCameraControls — 画布左下相机浮岛（Figma Global HUD：camera 左下 52；P12 动态视觉）。
// 取代隐藏的 Huabu Controls；通过 shell store camera 命令 → 唯一 Huabu camera。
// zoom 百分比读 RF useViewport（purely presentation）。

import { useViewport } from '@xyflow/react';
import { Maximize2, Minus, Plus } from 'lucide-react';

import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

export function LcosCameraControls(): React.JSX.Element {
  const requestCamera = useLcosShellStore((s) => s.requestCamera);
  const { zoom } = useViewport();

  const btn = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // 44px 热区（Figma Global HUD camera 岛高 52 = 44 + 上下 4 内边距）。
    width: 44,
    height: 44,
    color: lcosTokens.color.text,
    borderRadius: 12,
  } as const;

  return (
    <div
      data-lcos-camera-controls
      className="pointer-events-auto flex items-center gap-1 rounded-full px-1.5 py-1"
      style={{ ...lcosGlassStyle, position: 'absolute', left: 24, bottom: 24, zIndex: 30 }}
    >
      <button type="button" aria-label="缩小" title="缩小" style={btn} onClick={() => requestCamera('zoom-out')}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-12 text-center text-xs tabular-nums" style={{ color: lcosTokens.color.muted }}>
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="放大" title="放大" style={btn} onClick={() => requestCamera('zoom-in')}>
        <Plus className="h-4 w-4" />
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px" style={{ background: lcosTokens.color.borderSubtle }} />
      <button type="button" aria-label="适合画面" title="适合画面" style={btn} onClick={() => requestCamera('fit')}>
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
}