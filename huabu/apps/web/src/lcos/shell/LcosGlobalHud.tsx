// LcosGlobalHud — 项目级常驻全局控制（Figma hud 5388:27696：project 左 24 / Navigator 顶 24
// 居中 hug / Railway 左 24 / SurfaceDock 底 24 / camera 左下 52）。三者共享同一直观玻璃岛语言。
// 全部入口只发命令（shell store / worksite nav），不建第二 camera/search/graph。

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { beginChildWorksiteNavigation } from '../navigation/childWorksiteNavigation';
import { useLcosShellStore } from './lcosShellStore';


import { LcosRailway } from './LcosRailway';
import { type LcosSurfaceKey } from './lcosShellStore';
import { LcosSurfaceDock } from './LcosSurfaceDock';
import { NavigationHudProvider } from '../navigation/NavigationHudSlot';
import { LcosFocusWhere } from '../navigation/LcosFocusWhere';
import { ColorPinHud } from '../pin/ColorPinHud';

import type { RailwayDestinationV1 } from '@local-creative-os/contracts';

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
  /** route ?workspaceId= —— 显式子工作现场（ColorPin target 用；不得用 activeWorkspaceId 冒充 root surface）。 */
  readonly childWorkspaceId?: string;
}

export function LcosGlobalHud(props: LcosGlobalHudProps): React.JSX.Element {
  const navigate = useNavigate();
  const activateDestination = useCallback(async (destination: RailwayDestinationV1): Promise<void> => {
    if (!destination.available || !destination.surface || !destination.canvasId || !destination.workspaceId)
      throw new Error('目的地没有已确认的工作现场。');
    const shell = useLcosShellStore.getState();
    if (shell.projectId !== props.projectId) throw new Error('项目已经切换，未进入旧目的地。');
    const entered = await beginChildWorksiteNavigation({projectId:props.projectId,sourceSurface:shell.activeSurface,
      ...(shell.activeWorkspaceId ? {sourceWorkspaceId:shell.activeWorkspaceId} : {}),sourceWasChild:props.childWorkspaceId!==undefined,
      targetSurface:destination.surface,targetWorkspace:{id:destination.workspaceId as never,canvasId:destination.canvasId},navigate});
    if (!entered) throw new Error('未能进入目标现场，来源状态保留。');
  },[props.projectId,props.childWorkspaceId,navigate]);

  return (
    <NavigationHudProvider>
      <ColorPinHud
        projectId={props.projectId}
        surfaceByWorkspace={props.surfaceByWorkspace}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
        ensureWorkspaceCanvas={props.ensureWorkspaceCanvas}
        {...(props.childWorkspaceId === undefined ? {} : { childWorkspaceId: props.childWorkspaceId })}
      />
      <LcosRailway
        projectId={props.projectId}
        surfaceByWorkspace={props.surfaceByWorkspace}
        ensureWorkspaceCanvas={props.ensureWorkspaceCanvas}
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
    </NavigationHudProvider>
  );
}
