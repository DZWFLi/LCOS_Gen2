// LCOS 共享组件族 barrel（R1）。
// 八族与 Figma 母表的对应（exact node/component/variant → target → caller）见
// docs/construction/FIGMA_SOURCE_LEDGER.md。
// 其中 ProjectShell 与 SurfaceFeedback 的族实现在既有生产文件里原地升级，
// 不另建副本（禁止同一族出现第二套近似件）。

export { LcosNavigatorIslandView } from './LcosNavigatorIslandView';
export type {
  LcosNavigatorIslandState,
  LcosNavigatorIslandViewProps,
  LcosNavigatorPin,
  LcosPinTone,
} from './LcosNavigatorIslandView';

export { LcosRailwayView } from './LcosRailwayView';
export type { LcosRailwayViewItem, LcosRailwayViewProps } from './LcosRailwayView';

export { LcosWindowChrome } from './LcosWindowChrome';
export type { LcosWindowChromeProps, LcosWindowLayout, LcosWindowTab } from './LcosWindowChrome';

export { LcosCollectionSurface } from './LcosCollectionSurface';
export type {
  LcosCollectionOrganize,
  LcosCollectionRendition,
  LcosCollectionSurfaceProps,
} from './LcosCollectionSurface';

export { LcosTaskCard } from './LcosTaskCard';
export type { LcosTaskCardProps, LcosTaskCardState } from './LcosTaskCard';

export { LcosPortalPreview } from './LcosPortalPreview';
export type { LcosPortalPreviewProps, LcosPortalPreviewState } from './LcosPortalPreview';

export { LcosSurfaceFeedback } from '../LcosSurfaceFeedback';
export type {
  LcosFeedbackPresentation,
  LcosSurfaceFeedbackProps,
} from '../LcosSurfaceFeedback';

/** ProjectShell 的 Figma `现场` 轴（实现在 shell/LcosProjectShell.tsx）。 */
export type LcosProjectShellVariant = 'main' | 'context' | 'workflow';
