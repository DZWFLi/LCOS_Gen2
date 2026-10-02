// LcosProjectShell — LCOS 项目级 Shell（Figma ProjectShell 5386:436；route-level 唯一组合根）。
// 组成：项目身份胶囊（顶左）+ 三现场舞台（唯一 Canvas）+ GlobalHud（Navigator/Railway/Dock/camera）。
// Professional Stage 常驻；Composer 仅由 canvas-local 明确命令按需挂载。

import { ArrowLeft, Hand } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { resolvePortalAddress } from '../navigation/portalIdentity';
import { LcosGlobalHud } from './LcosGlobalHud';
import { LcosProjectSystemMenu } from './LcosProjectSystemMenu';
import { useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { LcosWorksiteStage } from './LcosWorksiteStage';
import { PortalDropWorkspaceProvider, toPortalDropWorkspaces } from '../drop/PortalDropWorkspaceContext';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { useLcosHostStore } from '../host/lcosHostState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { beginChildWorksiteNavigation } from '../navigation/childWorksiteNavigation';
import { returnToSourceWorksite } from '../navigation/returnToSourceWorksite';
import { useAvoidingHudPosition } from '../navigation/useAvoidingHudPosition';
import { useHudViewport } from '../navigation/useHudViewport';
import { LcosColorPinProvider } from '../pin/LcosColorPinProvider';
import { ProfessionalWindowStage } from '../professional/ProfessionalWindowStage';
import { ContextWorksite } from '../surfaces/context/ContextWorksite';
import { MainCollectionAtlas } from '../surfaces/main/MainCollectionAtlas';
import { MainWorksite } from '../surfaces/main/MainWorksite';
import { WorkflowHandOverlay, WorkflowWorksite } from '../surfaces/workflow/WorkflowWorksite';
import { FigmaShellGlyph } from '../ui/FigmaShellGlyph';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { PortalTargetResolution } from '../professional/PortalPreviewBody';
import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

export interface LcosProjectShellProps {
  readonly projectId: string;
  readonly projectName: string | null;
  readonly surface: LcosSurfaceKey;
  readonly workspaces: readonly Workspace[];
  /** Explicit child worksite identity from ?workspaceId=; never inferred from surface. */
  readonly childWorkspaceId?: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (
    surface: LcosSurfaceKey,
    force?: boolean,
  ) => Promise<string | undefined>;
  readonly ensureWorkspaceCanvas: (workspaceId: string, force?: boolean) => Promise<string | undefined>;
  readonly ensureError?: string;
  readonly shellStatus: 'loading' | 'ready' | 'offline' | 'error';
  readonly onRetry: () => void;
}

export function LcosProjectShell({
  projectId,
  projectName,
  surface,
  workspaces,
  childWorkspaceId,
  canvasBySurface,
  surfaceByWorkspace,
  ensureCanvas,
  ensureWorkspaceCanvas,
  ensureError,
  shellStatus,
  onRetry,
}: LcosProjectShellProps): React.JSX.Element {
  const navigate = useNavigate();
  const hudViewport = useHudViewport();
  const projectPlacement = useAvoidingHudPosition({ x: 24, y: 24, width: childWorkspaceId ? 308 : 256, height: 44 });
  const mainToolsPlacement = useAvoidingHudPosition({
    x: hudViewport.width - 128, y: hudViewport.height - 24, width: 104, height: 48,
  }, { y: 'end' }, '[data-lcos-surface-dock],[data-lcos-spatial-navigator-host]');

  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const stateProjectId = useLcosShellStore((s) => s.projectId);
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const setActiveWorkspaceId = useLcosShellStore(
    (s) => s.setActiveWorkspaceId,
  );
  const childReturn = useLcosShellStore((s) => s.childReturn);
  const setProject = useLcosShellStore((s) => s.setProject);
  const openAssembly = useLcosShellStore((s) => s.openAssembly);
  const mainNodeCount = useCanvasStore((s) => s.nodes.length);
  const [mainHandOpen, setMainHandOpen] = useState(false);
  const [mainAtlasOpen, setMainAtlasOpen] = useState(false);
  const retargetWorksiteAssembly = useLcosShellStore((s) => s.retargetWorksiteAssembly);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | undefined>(undefined);
  const watchArtifactChanges = useCollaborationSessionStore((s) => s.watchProjectChanges);

  useEffect(() => watchArtifactChanges(projectId, () => {
    useLcosHostStore.getState().host?.notifyMutationSuccess();
  }), [projectId, watchArtifactChanges]);

  const coreSession = useMemo(() => createLcosCoreSession(), []);
  const portalRootNavigation = useLcosWorksiteNav({projectId,canvasBySurface,ensureCanvas});
  const resolvePortalTarget = (canvasId: string, workspaceId?: string, sourceNodeId?: string): PortalTargetResolution | undefined => {
    const resolved = resolvePortalAddress(projectId,toPortalDropWorkspaces(workspaces),canvasId,workspaceId);
    return resolved ? {...resolved,...(sourceNodeId ? {sourceNodeId} : {})} : undefined;
  };

  const openPortalTarget = async (target: PortalTargetResolution, signal?: AbortSignal): Promise<boolean> => {
    const source = useCanvasStore.getState().canvasId;
    const shell = useLcosShellStore.getState();
    if (shell.projectId !== projectId || signal?.aborted) return false;
    const current = await coreSession.railway.portalTarget(projectId,target.workspaceId,signal);
    if (signal?.aborted || useLcosShellStore.getState().projectId !== projectId || useCanvasStore.getState().canvasId !== source) return false;
    if (!current.available || current.ref.kind !== 'worksite' || current.ref.worksiteId !== target.workspaceId
      || current.ref.projectId !== projectId || current.canvasId !== target.canvasId || current.surface !== target.targetSurface)
      throw new Error(current.reason ?? '原入口的目标已变化，请重新读取；不会跳转到别的现场。');
    if (current.canvasId === source) return true;
    if (canvasBySurface[target.targetSurface] === target.canvasId)
      return portalRootNavigation.switchWorksite(target.targetSurface);
    return beginChildWorksiteNavigation({
      projectId,sourceSurface:shell.activeSurface,
      ...(shell.activeWorkspaceId === null ? {} : {sourceWorkspaceId:shell.activeWorkspaceId}),
      sourceWasChild:childWorkspaceId !== undefined,targetSurface:target.targetSurface,
      targetWorkspace:{id:target.workspaceId as import('@local-creative-os/domain').Workspace['id'],canvasId:target.canvasId},
      ...(target.sourceNodeId && useCanvasStore.getState().nodes.some((n) => n.id === target.sourceNodeId) ? {sourceNodeId:target.sourceNodeId} : {}),
      navigate,signal,
    });
  };

  const childWorkspace = childWorkspaceId === undefined
    ? undefined
    : workspaces.find((workspace) => String(workspace.id) === childWorkspaceId);
  const effectiveCanvasBySurface = childWorkspaceId === undefined
    ? canvasBySurface
    : { ...canvasBySurface, [surface]: childWorkspace?.canvasId };
  const childUnavailable = childWorkspaceId !== undefined && (
    (shellStatus === 'ready' && childWorkspace === undefined) ||
    (childWorkspace !== undefined && childWorkspace.canvasId === undefined)
  );
  const ensureActiveCanvas = childWorkspaceId !== undefined
    ? (_surface: LcosSurfaceKey, force = false) => ensureWorkspaceCanvas(childWorkspaceId, force)
    : ensureCanvas;

  useEffect(() => { setMainHandOpen(false); setMainAtlasOpen(false); }, [projectId, activeSurface]);
  useEffect(() => {
    document.title = (projectName ?? '创意工作台') + ' · LCOS';
  }, [projectName]);
  const rootWorkspaces = workspaces.filter((workspace) => workspace.canvasId === canvasBySurface[surface]);
  const assemblyWorkspaceId = childWorkspaceId ?? (rootWorkspaces.length === 1 ? String(rootWorkspaces[0]!.id) : undefined);
  const worksiteTarget = useMemo<AssemblyTargetRefV1 | undefined>(() => surface === 'main' && childWorkspaceId === undefined
    ? { kind: 'main' } : assemblyWorkspaceId ? { kind: 'workspace', id: assemblyWorkspaceId } : undefined, [surface, childWorkspaceId, assemblyWorkspaceId]);
  const assemblyTitle = '装配 · ' + ({ main: '主画布', context: '上下文', workflow: '工作流' }[surface]);
  useEffect(() => {
    if (worksiteTarget) retargetWorksiteAssembly(worksiteTarget, assemblyTitle);
  }, [worksiteTarget, retargetWorksiteAssembly, assemblyTitle]);

  useEffect(() => {
    useLcosReferenceStore.getState().setProject(projectId);
    setProject(projectId);
    setActiveSurface(surface);
  }, [projectId, surface, setProject, setActiveSurface]);

  useEffect(() => {
    const candidates = workspaces.filter((workspace) => workspace.canvasId === canvasBySurface[activeSurface]);
    const workspaceId = childWorkspaceId ?? (candidates.length === 1 ? String(candidates[0]!.id) : undefined);
    setActiveWorkspaceId(workspaceId ?? null);
  }, [activeSurface, childWorkspaceId, setActiveWorkspaceId, workspaces, canvasBySurface]);

  const returnToSource = (): void => {
    if (returning) return;
    const context = childReturn;
    setReturning(true);
    setReturnError(undefined);
    void returnToSourceWorksite({ projectId, context, navigate })
      .catch((error: unknown) => setReturnError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReturning(false));
  };

  const active = activeSurface;

  return (
    <div
      data-lcos-family="project-shell"
      data-lcos-variant={active}
      data-lcos-project-shell
      data-main-curtain={active === 'main' ? (mainAtlasOpen ? 'atlas' : mainHandOpen ? 'hand' : undefined) : undefined}
      className="relative h-full w-full overflow-hidden"
    >
      {shellStatus !== 'ready' || stateProjectId !== projectId ? (
        <div className="flex h-full w-full items-center justify-center">
          <LcosWorksiteStageLoading status={shellStatus === 'ready' ? 'loading' : shellStatus} onRetry={onRetry} />
        </div>
      ) : (
        <LcosColorPinProvider projectId={projectId}>
          {/* 工作现场舞台（唯一 Canvas）；Main/Context/Workflow 各自壳（空态/仪器差异） */}
          <PortalDropWorkspaceProvider projectId={projectId} workspaces={toPortalDropWorkspaces(workspaces)} mainCanvasId={effectiveCanvasBySurface.main}>
          <div className="absolute inset-0">
            {childUnavailable ? (
              <ChildWorkspaceUnavailable
                workspaceId={childWorkspaceId}
                hasWorkspace={childWorkspace !== undefined}
                onReturn={returnToSource}
              />
            ) : active === 'main' ? (
              <MainWorksite
                projectId={projectId}
                surface={active}
                canvasId={effectiveCanvasBySurface[active]}
                canvasNodeCount={mainNodeCount}
                // 必须透传 recreate：Main 的「重新建立现场画布」按钮靠它强制重建，
                // 丢掉这个参数会退回到返回旧（失效）canvasId，按钮看起来点了没反应。
                  ensureCanvas={(recreate?: boolean) =>
                  ensureActiveCanvas(active, recreate)
                }
                ensureError={ensureError}
              />
            ) : active === 'context' ? (
              <ContextWorksite
                projectId={projectId}
                surface={active}
                canvasId={effectiveCanvasBySurface[active]}
                canvasBySurface={effectiveCanvasBySurface}
                workspaces={workspaces}
                ensureCanvas={ensureActiveCanvas}
                isChildWorksite={childWorkspaceId !== undefined}
              />
            ) : active === 'workflow' ? (
              <WorkflowWorksite
                projectId={projectId}
                surface={active}
                canvasId={effectiveCanvasBySurface[active]}
                workspaces={workspaces}
                isChildWorksite={childWorkspaceId !== undefined}
                ensureCanvas={ensureActiveCanvas}
              />
            ) : (
              <LcosWorksiteStage
                projectId={projectId}
                surface={active}
                canvasId={effectiveCanvasBySurface[active]}
                ensureCanvas={(recreate?: boolean) =>
                  ensureActiveCanvas(active, recreate)
                }
                ensureError={ensureError}
              />
            )}
          </div>
          </PortalDropWorkspaceProvider>

          {/* 项目身份胶囊（顶左；点击返回项目列表） */}
          <div ref={projectPlacement.ref} data-lcos-shell-project-cluster className="pointer-events-auto fixed z-40 flex items-center gap-2"
            style={{ left: projectPlacement.rect.x, top: projectPlacement.rect.y }}>
            {childWorkspaceId !== undefined && (
              <button
                type="button"
                data-lcos-child-return
                onClick={returnToSource}
                disabled={returning}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-60"
                style={{ ...lcosGlassStyle, color: lcosTokens.color.text }}
                title="返回来源现场"
                aria-label={returning ? '返回中…' : '返回来源现场'}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                <span data-lcos-child-return-label>{returning ? '返回中…' : '返回来源现场'}</span>
              </button>
            )}
            <LcosProjectSystemMenu name={projectName ?? projectId.slice(0, 12)}
              {...(worksiteTarget === undefined ? {} : { target: worksiteTarget })} assemblyTitle={assemblyTitle} />
            <button
              type="button"
              data-lcos-assembly-entry
              aria-label="Assembly"
              title={worksiteTarget ? '打开' + assemblyTitle : '现场尚未就绪'}
              disabled={worksiteTarget === undefined}
              onClick={() => { if (worksiteTarget) openAssembly(worksiteTarget, assemblyTitle, true); }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90"
              style={{ ...lcosGlassStyle, color: lcosTokens.color.text }}
            >
              <FigmaShellGlyph name="bench" size={20} />
            </button>
          </div>
          {returnError && (
            <div className="pointer-events-auto fixed top-[76px] left-6 z-40 rounded-full px-3 py-2 text-xs" style={{ ...lcosGlassStyle, color: lcosTokens.color.danger }}>
              {returnError}
            </div>
          )}

          {/* 全局 HUD：Navigator 岛 / Railway / Dock / FocusWhere */}
          <LcosGlobalHud
            projectId={projectId}
            canvasBySurface={effectiveCanvasBySurface}
            surfaceByWorkspace={surfaceByWorkspace}
            ensureCanvas={ensureCanvas}
            ensureWorkspaceCanvas={ensureWorkspaceCanvas}
            {...(childWorkspaceId === undefined ? {} : { childWorkspaceId })}
          />

          {/* 专业窗口舞台；Composer 由 canvas-local 明确命令挂载。 */}
          <ProfessionalWindowStage
            projectId={projectId}
            resolvePortalTarget={resolvePortalTarget}
            onOpenPortalTarget={openPortalTarget}
          />
          {active === 'main' && (
            <>
              <div ref={mainToolsPlacement.ref} data-lcos-main-tools className="pointer-events-auto fixed z-40 flex flex-row-reverse gap-2"
                style={{ left: mainToolsPlacement.rect.x, top: mainToolsPlacement.rect.y }}>
              <button
                type="button"
                aria-label="呼出工作流手牌"
                aria-expanded={mainHandOpen}
                title="工作流手牌"
                onClick={() => { setMainAtlasOpen(false); setMainHandOpen((open) => !open); }}
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full"
                style={lcosGlassStyle}
              >
                <Hand size={18} aria-hidden />
              </button>
              <button type="button" data-lcos-main-collection-atlas-trigger aria-label="打开项目集合总览" aria-expanded={mainAtlasOpen}
                title="项目集合（不含现场导航）" onClick={() => { setMainHandOpen(false); setMainAtlasOpen((open) => !open); }}
                className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full"
                style={lcosGlassStyle}><FigmaShellGlyph name="collection" size={21} /></button>
              </div>
              <AnimatePresence initial={false}>
                {mainAtlasOpen && <MainCollectionAtlas projectId={projectId} onClose={() => setMainAtlasOpen(false)} />}
              </AnimatePresence>
              <WorkflowHandOverlay
                projectId={projectId}
                workspaces={workspaces}
                sourceSurface="main"
                sourceWasChild={childWorkspaceId !== undefined}
                open={mainHandOpen}
                onClose={() => setMainHandOpen(false)}
              />
            </>
          )}
        </LcosColorPinProvider>
      )}
    </div>
  );
}

function ChildWorkspaceUnavailable({
  workspaceId,
  hasWorkspace,
  onReturn,
}: {
  readonly workspaceId?: string;
  readonly hasWorkspace: boolean;
  readonly onReturn: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ background: lcosTokens.color.canvas }}>
      <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
        <LcosSurfaceFeedback
          presentation="disabled"
          message={hasWorkspace ? '这个工作现场还没有可用画布' : '找不到指定的工作现场'}
        />
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          {hasWorkspace ? '需要先建立并绑定画布，才能进入编辑现场。' : `workspaceId：${workspaceId ?? '未提供'}`}
        </span>
        <button
          type="button"
          data-lcos-child-return-fallback
          onClick={onReturn}
          className="rounded-full px-4 py-2 text-sm font-medium"
          style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 44 }}
        >
          返回来源现场
        </button>
      </div>
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
      <div
        className="flex flex-col items-center gap-3"
        style={{ color: lcosTokens.color.muted }}
      >
        <span className="lcos-static-pulse text-sm">正在读取现场与画布…</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-sm" style={{ color: lcosTokens.color.danger }}>
        {status === 'offline'
          ? 'Local Core 未连接，无法进入项目'
          : '现场信息读取失败'}
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
