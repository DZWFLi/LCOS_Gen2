// lcosNativeChromePolicy — LCOS chrome mode 下的 Huabu 原生 chrome 显隐策略（纯函数）。
// 关闭的是可见控件，不关闭命令路径与 kernel 事件（ReactFlow/drag/zoom/select/history 全保留）。

export interface CanvasChromePolicy {
  readonly nodeToolbarVisible: boolean;
  readonly controlsVisible: boolean;
  readonly miniMapVisible: boolean;
  /** 选区上下文工具条（多选/描边/edge style）——LCOS mode 保留（画布局部选区语义）。 */
  readonly selectionToolbarsVisible: boolean;
}

export function canvasChromePolicy(mode: 'huabu' | 'lcos'): CanvasChromePolicy {
  if (mode === 'lcos') {
    return {
      nodeToolbarVisible: false,
      controlsVisible: false,
      miniMapVisible: false,
      selectionToolbarsVisible: true,
    };
  }
  return {
    nodeToolbarVisible: true,
    controlsVisible: true,
    miniMapVisible: true,
    selectionToolbarsVisible: true,
  };
}