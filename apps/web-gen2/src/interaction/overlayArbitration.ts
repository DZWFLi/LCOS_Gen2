// A07 — Overlay arbitration. 禁止 node Christmas tree：任何节点/画布浮层不得
// 由各 renderer 自由绝对定位按钮。节点级浮层走 NodeWrapper 既有 slot
// （toolbar/actions/overlayContent/takeover/priority）；画布级浮层统一收到一个
// LcosHostOverlay 容器，按本模块的纯函数仲裁结果渲染。互斥规则全部集中在这里，
// 是一个可测的纯逻辑，不掺 DOM/React。

/** 全部 LCOS overlay 种类（含尚未落线的，仲裁规则一并冻结）。 */
export type OverlayKind =
  | 'resize-handles'
  | 'node-toolbar'
  | 'connect-affordance'
  | 'reference-badge'
  | 'drop-preview'
  | 'action-arc'
  | 'composer'
  | 'focus-hud'
  | 'work-view';

/**
 * 仲裁输入 —— 只描述“外界发生了什么”，不描述“该显示什么”。
 * 由 LcosHostOverlay 从各 store（drop / reference / selection / 手势）采集，
 * 交给 visibleOverlays 推导互斥后的可见集合。
 */
export interface OverlayInput {
  readonly dragging: boolean;
  readonly resizing: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly composerOpen: boolean;
  readonly actionArcOpen: boolean;
  readonly workViewOpen: boolean;
  readonly dropPreview: boolean;
  readonly referenceBadge: boolean;
}

/**
 * 统一 z-index 分级。screen-space overlay，不得随 canvas zoom 缩到不可点；
 * 默认 pointer-events:none，真正按钮 pointer-events:auto。任何 LCOS 浮层
 * 必须从这层取值，不再散落内联 zIndex。
 */
export const overlayLayers = {
  canvasAdornment: 10,
  nodeChrome: 20,
  action: 30,
  composer: 40,
  workView: 50,
  modal: 60,
} as const;

const LAYER_BY_KIND: Readonly<Record<OverlayKind, number>> = {
  'resize-handles': overlayLayers.nodeChrome,
  'node-toolbar': overlayLayers.nodeChrome,
  'focus-hud': overlayLayers.nodeChrome,
  'connect-affordance': overlayLayers.action,
  'reference-badge': overlayLayers.action,
  'drop-preview': overlayLayers.action,
  'action-arc': overlayLayers.action,
  composer: overlayLayers.composer,
  'work-view': overlayLayers.workView,
};

/** 每个 overlay 应渲染的 screen-space z-index（语义即排序依据）。 */
export function overlayZ(kind: OverlayKind): number {
  return LAYER_BY_KIND[kind];
}

const REST_ORDER: readonly OverlayKind[] = [
  'resize-handles',
  'node-toolbar',
  'connect-affordance',
  'reference-badge',
  'drop-preview',
];

/** 休止态：不产生工具串。selected 才有 handles；hover 至多一个主 affordance。 */
export function compactRestingOverlays(
  input: OverlayInput,
): readonly OverlayKind[] {
  const out: OverlayKind[] = [];
  if (input.selected) out.push('resize-handles');
  else if (input.hovered) out.push('connect-affordance');
  if (input.referenceBadge) out.push('reference-badge');
  if (input.dropPreview) out.push('drop-preview');
  // 稳定的展示顺序（同层内按 REST_ORDER，避免测试快照抖动）。
  return REST_ORDER.filter((kind) => out.includes(kind));
}

/**
 * 仲裁主函数。互斥思想：
 *   - 拖拽中：只可能保留 drop-preview，其余全部让道（悬停指针下不应出现其他浮层）。
 *   - 缩放中：只有 resize-handles。
 *   - 打开工作台（work-view）：独占，归还整块画布。
 *   - 打开 composer：呈现 composer（reference badge 与其正交，不抵消）。
 *   - 打开 action-arc：呈现 action-arc（参考 badge 同样正交）。
 *   - 其余：休止态 —— 右上角的 selected handles / hover affordance，绝无工具串。
 * 任何路径都不会同时出现 resize-handles + node-toolbar + action-arc 三套。
 */
export function visibleOverlays(input: OverlayInput): readonly OverlayKind[] {
  if (input.dragging) return input.dropPreview ? ['drop-preview'] : [];
  if (input.resizing) return ['resize-handles'];
  if (input.workViewOpen) return ['work-view'];
  if (input.composerOpen) {
    const rest: OverlayKind[] = input.referenceBadge ? ['reference-badge'] : [];
    return ['composer', ...rest];
  }
  if (input.actionArcOpen) {
    const rest: OverlayKind[] = input.referenceBadge ? ['reference-badge'] : [];
    return ['action-arc', ...rest];
  }
  return compactRestingOverlays(input);
}
