// MainWorksite — Main 现场主体（项目主桌面）：真实 Huabu Canvas 舞台 + Main 专属空态提示。
// 内容优先；空画布时给出诚实引导（装配入口 Wave 5 接上后才启用，不铺死按钮）。

import { LcosWorksiteStage } from '../../shell/LcosWorksiteStage';
import { lcosGlassStyle, lcosTokens } from '../../ui/lcosTokens';

import type { LcosSurfaceKey } from '../../shell/lcosShellStore';

export interface MainWorksiteProps {
  readonly projectId: string;
  readonly surface: LcosSurfaceKey;
  readonly canvasId?: string;
  readonly canvasNodeCount: number;
  readonly ensureCanvas: (recreate?: boolean) => Promise<string | undefined>;
  readonly ensureError?: string;
}

export function MainWorksite(props: MainWorksiteProps): React.JSX.Element {
  return (
    <div data-lcos-main-worksite className="relative h-full w-full">
      <LcosWorksiteStage
        projectId={props.projectId}
        surface={props.surface}
        canvasId={props.canvasId}
        ensureCanvas={props.ensureCanvas}
        ensureError={props.ensureError}
      />
      {props.canvasId !== undefined && props.canvasNodeCount === 0 && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          <div className="flex flex-col items-center gap-2 rounded-2xl px-6 py-5" style={lcosGlassStyle}>
            <span className="text-sm font-medium" style={{ color: lcosTokens.color.text }}>
              空的主现场
            </span>
            <span className="max-w-[260px] text-center text-xs leading-relaxed" style={{ color: lcosTokens.color.muted }}>
              用顶部搜索把项目里的材料带到 Main，或从 Assembly 取用材料。
            </span>
          </div>
        </div>
      )}
    </div>
  );
}