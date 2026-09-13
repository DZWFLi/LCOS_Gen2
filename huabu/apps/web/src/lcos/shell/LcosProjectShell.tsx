// LcosProjectShell — LCOS 项目级 Shell（Figma ProjectShell 5386:436；route-level 唯一组合根）。
// 组成：项目身份胶囊（顶左）+ 三现场舞台（唯一 Canvas）+ GlobalHud（Navigator/Railway/Dock/camera）。
// Professional Stage / Composer 在 Wave 5 挂入；未接线入口一律不渲染（避免死按钮）。

import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import { LcosGlobalHud } from './LcosGlobalHud';
import { SURFACE_LABEL, useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { LcosWorksiteStage } from './LcosWorksiteStage';
import { LcosComposerHost } from '../composer/LcosComposerHost';
import { ProfessionalWindowStage } from '../professional/ProfessionalWindowStage';
import { ContextWorksite } from '../surfaces/context/ContextWorksite';
import { MainWorksite } from '../surfaces/main/MainWorksite';
import { WorkflowWorksite } from '../surfaces/workflow/WorkflowWorksite';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

export interface LcosProjectShellProps {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly surface: LcosSurfaceKey;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
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

  // 当前现场的真实 workspaceId：由 Core workspaces 反查（surfaceByWorkspace 的逆映射）。
  // Composer 用它创建 Run；缺省时明确禁用提交，不拿假 workspace 去撞 Core 外键。
  const activeWorkspaceId = useMemo<string | undefined>(() => {
    for (const [workspaceId, workspaceSurface] of surfaceByWorkspace) {
      if (workspaceSurface === active) return workspaceId;
    }
    return undefined;
  }, [surfaceByWorkspace, active]);

  return (
    <div
      data-lcos-family="project-shell"
      data-lcos-variant={active}
      data-lcos-project-shell
      className="relative h-full w-full overflow-hidden"
    >
      {shellStatus !== 'ready' ? (
        <div className="flex h-full w-full items-center justify-center">
          <LcosWorksiteStageLoading status={shellStatus} onRetry={onRetry} />
        </div>
      ) : (
        <>
          {/* 工作现场舞台（唯一 Canvas）；Main/Context/Workflow 各自壳（空态/仪器差异） */}
          <div className="absolute inset-0">
            {active === 'main' ? (
              <MainWorksite
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                canvasNodeCount={mainNodeCount}
                // 必须透传 recreate：Main 的「重新建立现场画布」按钮靠它强制重建，
                // 丢掉这个参数会退回到返回旧（失效）canvasId，按钮看起来点了没反应。
                ensureCanvas={(recreate?: boolean) => ensureCanvas(active, recreate)}
                ensureError={ensureError}
              />
            ) : active === 'context' ? (
              <ContextWorksite
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                canvasBySurface={canvasBySurface}
                ensureCanvas={ensureCanvas}
              />
            ) : active === 'workflow' ? (
              <WorkflowWorksite
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                ensureCanvas={ensureCanvas}
              />
            ) : (
              <LcosWorksiteStage
                projectId={projectId}
                surface={active}
                canvasId={canvasBySurface[active]}
                ensureCanvas={(recreate?: boolean) => ensureCanvas(active, recreate)}
                ensureError={ensureError}
              />
            )}
          </div>

          {/* 项目身份胶囊（顶左；点击返回项目列表） */}
          <div className="pointer-events-auto fixed left-6 top-6 z-40">
            <Link
              to="/projects"
              className="line-clamp-1 inline-flex max-w-[42vw] items-center gap-2 rounded-full py-2 pr-4 text-sm font-medium transition-colors hover:opacity-90"
              style={{ ...lcosGlassStyle, minHeight: 44, color: lcosTokens.color.text }}
              title="返回项目列表"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} />
              <span className="truncate font-semibold">{projectName ?? projectId.slice(0, 12)}</span>
              <span className="ml-1 shrink-0 text-xs" style={{ color: lcosTokens.color.muted }}>
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

          {/* Wave 5：route-level 专业窗口舞台 + 统一 Composer */}
          <ProfessionalWindowStage projectId={projectId} />
          <LcosComposerHost projectId={projectId} workspaceId={activeWorkspaceId} />
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
      <div className="flex flex-col items-center gap-3" style={{ color: lcosTokens.color.muted }}>
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
          background: lcosTokens.color.inverse,
          color: lcosTokens.color.textOnInverse,
          minHeight: 44,
        }}
      >
        重试
      </button>
    </div>
  );
}
