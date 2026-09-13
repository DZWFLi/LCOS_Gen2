// TemporalRail — Context 子现场右侧局部时间轨（Figma temporal 5388:25701：右 24、宽 65）。
// 固定视觉密度 / Episode 聚合由 T6 时间分组 producer 提供（Wave 8 绑定真实 Run/事件时间）；
// 当前为诚实空态骨架：不画虚假刻度，无 producer 时显示原因，hover 鱼眼/wheel 窗口 Wave 8。

import { Clock3 } from 'lucide-react';

import { lcosGlassStyle, lcosTokens } from '../../ui/lcosTokens';

export function TemporalRail(): React.JSX.Element {
  return (
    <div
      data-lcos-temporal-rail
      className="pointer-events-auto fixed right-6 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-3 px-3 py-4"
      style={{ ...lcosGlassStyle, width: 65, maxHeight: 555, minHeight: 120 }}
    >
      <Clock3 className="h-4 w-4" style={{ color: lcosTokens.color.muted }} aria-hidden />
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-medium" style={{ color: lcosTokens.color.muted }}>时间轨</span>
        <span className="text-center text-[9px] leading-tight" style={{ color: lcosTokens.color.muted }}>
          时间分组尚未接入
        </span>
      </div>
      <span className="h-px w-8" style={{ background: lcosTokens.color.borderSubtle }} aria-hidden />
      <span className="text-[9px] leading-tight" style={{ color: lcosTokens.color.muted }}>
        不绘制虚假刻度
      </span>
    </div>
  );
}