// LcosGlobalHud — 项目级常驻全局控制（Figma hud 5388:27696：project 左 24 / Navigator 顶 24
// 居中 hug / Railway 左 24 / SurfaceDock 底 24 / camera 左下 52）。三者共享同一直观玻璃岛语言。
// 全部入口只发命令（shell store / worksite nav），不建第二 camera/search/graph。

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import { LcosRailway } from './LcosRailway';
import { useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { LcosSurfaceDock } from './LcosSurfaceDock';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { LcosFocusWhere } from '../navigation/LcosFocusWhere';
import { LcosNavigatorIsland } from '../navigation/LcosNavigatorIsland';

import type { RailwayDestinationProjection } from '../navigation/railwayProjection';

export interface LcosGlobalHudProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (
    surface: LcosSurfaceKey,
  ) => Promise<string | undefined>;
  readonly ensureWorkspaceCanvas: (
    workspaceId: string,
  ) => Promise<string | undefined>;
}

export function LcosGlobalHud(props: LcosGlobalHudProps): React.JSX.Element {
  const { switchWorksite } = useLcosWorksiteNav({
    projectId: props.projectId,
    canvasBySurface: props.canvasBySurface,
    ensureCanvas: props.ensureCanvas,
  });
  const navigate = useNavigate();
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const { ensureWorkspaceCanvas } = props;
  const activateDestination = useCallback(
    async (destination: RailwayDestinationProjection): Promise<void> => {
      if (destination.surface === undefined) return;
      if (destination.workspaceId === undefined) {
        const switched = await switchWorksite(destination.surface);
        if (!switched) throw new Error('未能进入目标现场，请重试');
        return;
      }
      const canvasId = await ensureWorkspaceCanvas(destination.workspaceId);
      if (canvasId === undefined) {
        throw new Error('目标现场还没有可用画布');
      }
      const loaded = await useCanvasStore.getState().switchCanvas(canvasId);
      if (!loaded) {
        throw new Error('未能读取目标现场，请重试');
      }
      setActiveSurface(destination.surface);
      navigate(
        `/projects/${encodeURIComponent(props.projectId)}/${destination.surface}?workspaceId=${encodeURIComponent(destination.workspaceId)}`,
        { replace: true },
      );
    },
    [ensureWorkspaceCanvas, navigate, props.projectId, setActiveSurface, switchWorksite],
  );

  return (
    <>
      <LcosNavigatorIsland
        projectId={props.projectId}
        surfaceByWorkspace={props.surfaceByWorkspace}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
        ensureWorkspaceCanvas={props.ensureWorkspaceCanvas}
      />
      <LcosRailway
        projectId={props.projectId}
        surfaceByWorkspace={props.surfaceByWorkspace}
        activateDestination={activateDestination}
      />
      <LcosFocusWhere
        projectId={props.projectId}
        surfaceByWorkspace={props.surfaceByWorkspace}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
      />
      <LcosSurfaceDock
        projectId={props.projectId}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
      />
    </>
  );
}
