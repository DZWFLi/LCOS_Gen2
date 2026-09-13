// PortalPreviewBody — 专业窗口里的 Portal 目标预览 body（Figma 5348:1151 六状态）。
// 由 LcosSpeciesBodies 的 portal 物种双击触发（与 GlythNodeBody 同一 local intent 机制：
// shellStore.openWindow；不创建第二份 canvas/selection truth）。
//
// 诚实边界：窗口内**真正渲染目标现场**属于 R4（Context/Portal/Atlas/Temporal）。
// 本 body 只表达两种由真实事实推导的状态：
//   - 目标解析不出 → 目标缺失
//   - 目标解析出   → 可预览（显示真实 target 身份），并显式标注「现场内渲染尚未接入」
// 其余四态（加载中/旧缓存/部分预览/预览失败）只在 dev gallery 展示，不在生产伪造。

import { useMemo } from 'react';

import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosPortalPreview, type LcosPortalPreviewState } from '../ui/families';
import { lcosTokens } from '../ui/lcosTokens';

export interface PortalPreviewBodyProps {
  readonly projectId: string;
  /** portal 节点的目标身份（canvasId / entityId）；缺省即无目标。 */
  readonly target?: string;
}

export function PortalPreviewBody({ projectId, target }: PortalPreviewBodyProps): React.JSX.Element {
  const canvasBySurface = useLcosShellStore((s) => s.surfaceCanvasId);
  const state: LcosPortalPreviewState = target ? '可预览' : '目标缺失';

  // 目标是否就是本项目三个现场之一（真实事实，不是猜测）。
  const surfaceOfTarget = useMemo(() => {
    if (!target) return undefined;
    return (Object.entries(canvasBySurface) as [string, string][]).find(([, id]) => id === target)?.[0];
  }, [canvasBySurface, target]);

  return (
    <div className="flex flex-col gap-2 p-4">
      <LcosPortalPreview
        state={state}
        title="入口目标预览"
        detail={
          target
            ? surfaceOfTarget
              ? `target=${target}（本项目 ${surfaceOfTarget} 现场）`
              : `target=${target}`
            : `projectId=${projectId}`
        }
      >
        <span className="px-4 text-center text-xs" style={{ color: lcosTokens.color.muted }}>
          窗口内渲染目标现场尚未接入（R4 · Context/Portal）；此处只表达目标身份与可达状态。
        </span>
      </LcosPortalPreview>
    </div>
  );
}
