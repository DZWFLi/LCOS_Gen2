// LcosWorksiteStage — 工作现场舞台：驱动 Huabu canvasStore 加载/切换真实 canvas，
// 并挂载唯一 Huabu Canvas（Wave 1 原生节点；Wave 2 换 CanvasHostBoundary 收口 chrome）。
// 加载副作用（loadCanvas/switchCanvas）沿用 CanvasPage 机制（KEEP KERNEL）。

import { useEffect, useRef, useState } from 'react';
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
  /** recreate=true：引用失效恢复（重建画布并回写）。 */
  readonly ensureCanvas: (recreate?: boolean) => Promise<string | undefined>;
  readonly ensureError?: string;
}

/**
 * During a surface transition the outgoing stage briefly remains mounted after
 * the nav controller has switched the shared canvas store. It must not switch
 * the store back to its stale prop. A stage may switch only when its requested
 * canvas is neither the current store canvas nor the canvas it originally
 * mounted for. The guard is driven by the requested prop changing, so an
 * external store update cannot make an unchanged prop switch back.
 */
export function shouldStageSwitchCanvas(input: {
  readonly requestedCanvasId: string;
  readonly storeCanvasId: string | null;
  readonly previousRequestedCanvasId: string | null;
}): boolean {
  return (
    input.requestedCanvasId !== input.previousRequestedCanvasId &&
    input.requestedCanvasId !== input.storeCanvasId &&
    input.previousRequestedCanvasId !== null
  );
}

export function LcosWorksiteStage({
  projectId,
  surface,
  canvasId,
  ensureCanvas,
  ensureError,
}: LcosWorksiteStageProps): React.JSX.Element {
  const { t } = useTranslation();
  const [recreating, setRecreating] = useState(false);
  const recreateError = useRef<string | undefined>(undefined);
  const switchCanvas = useCanvasStore((s) => s.switchCanvas);
  const isLoading = useCanvasStore((s) => s.isLoading);
  const canvasLoadFailure = useCanvasStore((s) => s.canvasLoadFailure);
  const storeCanvasId = useCanvasStore((s) => s.canvasId);
  const requestedCanvasRef = useRef<string | null>(null);

  useEffect(() => {
    const previousRequestedCanvasId = requestedCanvasRef.current;
    if (!canvasId) {
      requestedCanvasRef.current = null;
      return;
    }
    requestedCanvasRef.current = canvasId;
    if (previousRequestedCanvasId === null) {
      // Nav may have completed switchCanvas before the new stage mounts.
      // Avoid a redundant reload in that case.
      if (canvasId !== storeCanvasId) void switchCanvas(canvasId);
    } else if (shouldStageSwitchCanvas({
      requestedCanvasId: canvasId,
      storeCanvasId,
      previousRequestedCanvasId,
    })) {
      void switchCanvas(canvasId);
    }
  }, [canvasId, storeCanvasId, switchCanvas]);

  if (!canvasId) {
    return (
      <div
        data-lcos-worksite-stage-empty={surface}
        className="flex h-full w-full items-center justify-center"
        style={{ background: lcosTokens.color.canvas }}
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
              background: lcosTokens.color.inverse,
              color: lcosTokens.color.textOnInverse,
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

  const targetFailure = canvasLoadFailure?.canvasId === canvasId ? canvasLoadFailure : null;
  if (targetFailure?.kind === 'error') {
    return (
      <div data-lcos-worksite-load-error className="flex h-full w-full items-center justify-center" style={{ background: lcosTokens.color.canvas }}>
        <LcosSurfaceFeedback
          presentation="disabled"
          message={`现场加载失败：${targetFailure.message}`}
          onAction={() => void switchCanvas(canvasId)}
          actionLabel="重试加载"
        />
      </div>
    );
  }

  if (targetFailure?.kind === 'not-found') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4" style={{ background: lcosTokens.color.canvas }}>
        <LcosSurfaceFeedback
          presentation="disabled"
          message={t('canvasPage.notFoundDescription')}
          onAction={() => void switchCanvas(canvasId)}
          actionLabel="重试加载"
        />
        {/* 恢复：画布引用失效/缺失 → 重建并回写 workspace.canvasId（真实 createCanvas） */}
        <button
          type="button"
          data-lcos-recover-canvas
          disabled={recreating}
          onClick={() => {
            setRecreating(true);
            recreateError.current = undefined;
            void ensureCanvas(true)
              .then((created) => {
                if (created) return switchCanvas(created);
                recreateError.current = '现场画布建立失败（检查 Core 连接与权限）';
                return undefined;
              })
              .catch((error: unknown) => {
                recreateError.current = error instanceof Error ? error.message : String(error);
              })
              .finally(() => setRecreating(false));
          }}
          className="rounded-full px-5 font-medium"
          style={{
            background: lcosTokens.color.inverse,
            color: lcosTokens.color.textOnInverse,
            minHeight: 44,
          }}
        >
          {recreating ? '建立中…' : '重新建立现场画布（回写 workspace）'}
        </button>
        {recreateError.current && (
          <span className="text-xs" style={{ color: lcosTokens.color.danger }}>{recreateError.current}</span>
        )}
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
    <div data-lcos-worksite-stage={surface} data-lcos-canvas-id={storeCanvasId} className="relative h-full w-full overflow-hidden">
      <CanvasHostBoundary projectId={projectId} chromeMode="lcos" />
    </div>
  );
}
