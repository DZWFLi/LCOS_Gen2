// T2 C2-3A · SpatialFocusPort（T1/Huabu 提供的窄能力端口，C2-3 §9）。
//
// 唯一 camera 请求入口：Focus / Locate / Fit 都走这一个端口，不散落
// ReactFlow 调用（§10：五个 HUD 各自 setCenter 就会产生五个 camera policy）。
// 实现 owner = T1/Huabu（聚焦几何在 focusNodesOnCanvas.ts 附近）；consumer =
// T2 Focus / Locator / Pin / Spatial Navigator / Search handoff。
//
// 只传 nodeIds + semantic mode + safeRect；不跨 Core 坐标（§16/§17）。

import type { ScreenRect } from '../spatial/locatorGeometry.js';

export type SpatialFocusMode = 'locate' | 'focus' | 'fit';

export type SpatialFocusResult =
  | {
      status: 'settled';
      nodeIds: readonly string[];
      targetScreenRect: ScreenRect;
    }
  | { status: 'unavailable'; reason: 'missing-node' | 'hidden-node' | 'no-bounds' };

export interface SpatialFocusPort {
  locateNodes(input: {
    nodeIds: readonly string[];
    safeRect: ScreenRect;
  }): Promise<SpatialFocusResult>;

  focusNodes(input: {
    nodeIds: readonly string[];
    safeRect: ScreenRect;
  }): Promise<SpatialFocusResult>;

  fitCanvas(input: { safeRect: ScreenRect }): Promise<SpatialFocusResult>;
}
