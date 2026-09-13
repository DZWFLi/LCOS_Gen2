// LcosWorksiteStage — 工作现场舞台：驱动 Huabu canvasStore 加载/切换真实 canvas，
// 并挂载唯一 Huabu Canvas（Wave 1 原生节点；Wave 2 换 CanvasHostBoundary 收口 chrome）。
// 加载副作用（loadCanvas/switchCanvas）沿用 CanvasPage 机制（KEEP KERNEL）。

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Loading } from '@/components/Common/Loading';
import useCanvasStore from '@/store/canvasStore';

import { CanvasHostBoundary } from '../host/CanvasHostBoundary';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';
import type { LcosSurfaceKey } from '../shell/lcosShellStore';

export interface LcosWorksiteStageProps {
  readonly projectId: string;
  readonly surface: LcosSurfaceKey;
  readonly canvasId?: string;
  readonly ensureCanvas: () => Promise<string | undefined>;
  readonly ensureError?: string;
}

export function LcosWorksiteStage({
  projectId,
  surface,
  canvasId,
  ensureCanvas,
  ensureError,
}: LcosWorksiteStageProps): React.JSX.Element {
  const { t } = useTranslation();
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const switchCanvas = useCanvasStore((s) => s.switchCanvas);
  const isLoading = useCanvasStore((s) => s.isLoading);
  const canvasNotFound = useCanvasStore((s) => s.canvasNotFound);
  const storeCanvasId = useCanvasStore((s) => s.canvasId);
  const initialisedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canvasId) return;
    if (initialisedRef.current === null) {
      initialisedRef.current = canvasId;
      void loadCanvas(canvasId);
    } else if (canvasId !== storeCanvasId) {
      void switchCanvas(canvasId);
    }
  }, [canvasId, storeCanvasId, loadCanvas, switchCanvas]);

  if (!canvasId) {
    return (
      <div
        data-lcos-worksite-stage-empty={surface}
        className="flex h-full w-full items-center justify-center"
        style={{ background: lcosTokens.color.canvas.light }}
      >
        <div className="flex flex-col items-center gap-4">
          <LcosSurfaceFeedback
            presentation="empty"
            message={`${surface} 现场还没有画布 · 建立后进入`}
          />
          <button
            type="button"
            onClick={() => void ensureCanvas()}
            className="rounded-full px-5 font-medium transition-colors"
            style={{
              background: lcosTokens.color.inverse.light,
              color: lcosTokens.color.textOnInverse.light,
              minHeight: 44,
              fontSize: lcosTokens.fontSize.md,
            }}
          >
            建立{surface === 'main' ? '主' : surface === 'context' ? 'Context' : 'Workflow'}画布
          </button>
          {ensureError && (
            <span className="text-xs" style={{ color: lcosTokens.color.danger }}>{ensureError}</span>
          )}
        </div>
      </div>
    );
  }

  if (canvasNotFound) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: lcosTokens.color.canvas.light }}>
        <LcosSurfaceFeedback
          presentation="disabled"
          message={t('canvasPage.notFoundDescription')}
          onAction={() => void loadCanvas(canvasId)}
          actionLabel="重试加载"
        />
      </div>
    );
  }

  if (isLoading || storeCanvasId !== canvasId) {
    return (
      <Loading
        variant="brand"
        layout="block"
        size="md"
        message={t('canvasPage.loading')}
      />
    );
  }

  return (
    <div data-lcos-worksite-stage={surface} className="relative h-full w-full overflow-hidden">
      <CanvasHostBoundary projectId={projectId} chromeMode="lcos" />
    </div>
  );
}