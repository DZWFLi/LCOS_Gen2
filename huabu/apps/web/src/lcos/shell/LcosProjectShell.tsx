// LcosProjectShell — LCOS 项目级 Shell（Figma ProjectShell 5386:436；route-level 唯一组合根）。
// 组成：项目身份胶囊（顶左）+ 三现场舞台（唯一 Canvas）+ GlobalHud（Navigator/Railway/Dock/camera）。
// Professional Stage / Composer 在 Wave 5 挂入；未接线入口一律不渲染（避免死按钮）。

import { ChevronLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import { LcosGlobalHud } from './LcosGlobalHud';
import { SURFACE_LABEL, useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { LcosWorksiteStage } from './LcosWorksiteStage';
import { MainWorksite } from '../surfaces/main/MainWorksite';
import { lcosTokens } from '../ui/lcosTokens';

export interface LcosProjectShellProps {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly surface: LcosSurfaceKey;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey) => Promise<string | undefined>;
  readonly ensureError?: string;
  readonly shellStatus: 'loading' | 'ready' | 'offline' | 'error';
  readonly onRetry: () => void;
}

export function LcosProjectShell({
  projectId,
  projectName,
  surface,
  canvasBySurface,
  surfaceByWorkspace,
  ensureCanvas,
  ensureError,
  shellStatus,
  onRetry,
}: LcosProjectShellProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const setProject = useLcosShellStore((s) => s.setProject);
  const mainNodeCount = useCanvasStore((s) => s.nodes.length);

  useEffect(() => {
    setProject(projectId);
    setActiveSurface(surface);
  }, [projectId, surface, setProject, setActiveSurface]);

  const active = activeSurface;

  return (
    <div
      data-lcos-project-shell
      className="relative h-full w-full overflow-hidden"
      style={{ background: lcosTokens.color.canvas.light, color: lcosTokens.color.text.light }}
    >
      {shellStatus !== 'ready' ? (
        <div className="flex h-full w-full items-center justify-center">
          <LcosWorksiteStageLoading status={shellStatus} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {/* 工作现场舞台（唯一 Canvas）；Main 用主现场壳（空态引导），Context/Workflow 用通用舞台 */}
          <div className="absolute inset-0">
            {active === 'main' ? (
              <MainWorksite
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                canvasNodeCount={mainNodeCount}
                ensureCanvas={() => ensureCanvas(active)}
                ensureError={ensureError}
              />
            ) : (
              <LcosWorksiteStage
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                ensureCanvas={() => ensureCanvas(active)}
                ensureError={ensureError}
              />
            )}
          </div>

          {/* 项目身份胶囊（顶左；点击返回项目列表） */}
          <div className="pointer-events-auto fixed left-6 top-6 z-40">
            <Link
              to="/projects"
              className="line-clamp-1 inline-flex max-w-[42vw] items-center gap-2 rounded-full py-2 pr-4 text-sm font-medium transition-colors hover:opacity-90"
              style={{
                background: 'rgba(252,252,252,0.86)',
                backdropFilter: 'blur(18px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
                border: '1px solid rgba(0,0,0,0.09)',
                boxShadow: '0 4px 12px rgba(40,48,58,0.075)',
                minHeight: 44,
                color: lcosTokens.color.text.light,
              }}
              title="返回项目列表"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted.light }} />
              <span className="truncate font-semibold">{projectName ?? projectId.slice(0, 12)}</span>
              <span className="ml-1 shrink-0 text-xs" style={{ color: lcosTokens.color.muted.light }}>
                {SURFACE_LABEL[active]}
              </span>
            </Link>
          </div>

          {/* 全局 HUD：Navigator 岛 / Railway / Dock / FocusWhere */}
          <LcosGlobalHud
            projectId={projectId}
            canvasBySurface={canvasBySurface}
            surfaceByWorkspace={surfaceByWorkspace}
            ensureCanvas={ensureCanvas}
          />

          {/* Route-level 空区域槽位：Professional Stage / Composer（Wave 5 挂入 body registry） */}
          <div data-lcos-region="professional-stage" className="hidden" aria-hidden />
          <div data-lcos-region="composer" className="hidden" aria-hidden />
        </>
      )}
    </div>
  );
}

function LcosWorksiteStageLoading({
  status,
  onRetry,
}: {
  readonly status: 'loading' | 'offline' | 'error';
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3" style={{ color: lcosTokens.color.muted.light }}>
        <span className="lcos-static-pulse text-sm">正在读取现场与画布…</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-sm" style={{ color: lcosTokens.color.danger }}>
        {status === 'offline' ? 'Local Core 未连接，无法进入项目' : '现场信息读取失败'}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full px-5 font-medium"
        style={{
          background: lcosTokens.color.inverse.light,
          color: lcosTokens.color.textOnInverse.light,
          minHeight: 44,
        }}
      >
        重试
      </button>
    </div>
  );
}