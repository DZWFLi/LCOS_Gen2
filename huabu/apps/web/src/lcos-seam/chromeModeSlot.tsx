// 中立 seam：把 Canvas 的 chromeMode 下发给深层节点组件。
//
// 为什么需要它：`<Canvas chromeMode="lcos">` 只到 Canvas 这一层，而"旧 Huabu 节点工具条
// 是否挂载"的决定点在 `NodeWrapper`（每个节点内部）。这里只传递一个字符串，
// 不携带任何 LCOS 领域语义，也不改变任何命令路径 —— 退役的只是可见壳。
//
// 与 NodeBodyResolverContext 同层、同性质（Canvas 提供 → 节点消费）。

import { createContext, useContext } from 'react';

export type CanvasChromeMode = 'huabu' | 'lcos';

const CanvasChromeModeContext = createContext<CanvasChromeMode>('huabu');

export const CanvasChromeModeProvider = CanvasChromeModeContext.Provider;

export function useCanvasChromeMode(): CanvasChromeMode {
  return useContext(CanvasChromeModeContext);
}

/**
 * LCOS 模式下**停止挂载**旧 NodeFloatingToolbar 的节点类型。
 *
 * 判定依据（2026-09-14 R2 返工，逐类读码核对旧工具条四组控件）：
 *   类型提示/转换 → LCOS Arc「转为文本」；
 *   强调色        → LCOS Arc「强调色」色板；
 *   尺寸 W/H      → LCOS Arc「尺寸」输入；
 *   打开大视图    → LCOS Arc「打开大视图」；
 *   Move Space    → LCOS Arc「移动到其它现场」；
 *   note 高度模式 → LCOS Arc「自动高度/固定高度」；
 *   删除          → LCOS Arc「删除节点」（Core 投影给真实 reason）。
 *
 * 只列**每一个旧控件都有 LCOS 替代入口**的类型。用户裁决原文：
 * 「若某项命令确实没有替代入口，R2 继续 PARTIAL，不能先删能力。」
 *
 * 因此以下类型**故意留在名单之外，继续挂旧工具条**（能力不删）：
 *   - `pdf` / `office`：旧 actions 有「下载」，LCOS 尚未接线 → 继续挂旧壳；
 *   - `web`：旧 actions 有「打开外链」；
 *   - `sketch`：笔触控制；`question`：AI 运行/取消；`frame`：容器布局模式；
 *   - `text`：原生自由文本的字号/格式（未绑定 Core 的自由文本仍允许就地编辑）。
 */
export const LCOS_STANDDOWN_TOOLBAR_TYPES: ReadonlySet<string> = new Set([
  'note',
  'image',
  'video',
  'audio',
  'canvasRef',
  'nodeRef',
]);

/** 该节点在 LCOS 模式下是否应交由 LCOS Arc、不再挂旧工具条。 */
export function shouldStandDownLegacyNodeToolbar(
  chromeMode: CanvasChromeMode,
  nodeType: string,
): boolean {
  return chromeMode === 'lcos' && LCOS_STANDDOWN_TOOLBAR_TYPES.has(nodeType);
}
