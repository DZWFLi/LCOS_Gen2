// LcosGlobalHud — 项目级常驻全局控制（Figma hud 5388:27696：project 左 24 / Navigator 顶 24
// 居中 hug / Railway 左 24 / SurfaceDock 底 24 / camera 左下 52）。三者共享同一直观玻璃岛语言。
// 全部入口只发命令（shell store / worksite nav），不建第二 camera/search/graph。

import { LcosRailway } from './LcosRailway';
import { LcosSurfaceDock } from './LcosSurfaceDock';
import { LcosFocusWhere } from '../navigation/LcosFocusWhere';
import { LcosNavigatorIsland } from '../navigation/LcosNavigatorIsland';

import type { LcosSurfaceKey } from './lcosShellStore';

export interface LcosGlobalHudProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey) => Promise<string | undefined>;
}

export function LcosGlobalHud(props: LcosGlobalHudProps): React.JSX.Element {
  return (
    <>
      <LcosNavigatorIsland
        projectId={props.projectId}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
      />
      <LcosRailway
        projectId={props.projectId}
        canvasBySurface={props.canvasBySurface}
        ensureCanvas={props.ensureCanvas}
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