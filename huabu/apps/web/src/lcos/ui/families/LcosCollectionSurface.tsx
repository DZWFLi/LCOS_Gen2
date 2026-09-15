// LcosCollectionSurface — 共享组件族 Collection（Figma 5333:96 上下文跨视图 / 5334:46 工作流跨视图）。
// 两个变体轴与取值与 Figma 一致：组织 = 事情/时间（5334:46 无此轴；生产未知时保留未指定），呈现 = 总览/主画布/装配。
// 体块尺寸 248×244（Figma 变体框尺寸）；列间 32 由 Atlas 布局负责，不写进组件。
// 注意：page 13 的这组组件未随 structures/ 导出，内层细分几何不在本次证据内，
// 因此本组件只表达「轴 + 体块 + 身份」，不虚构内层像素细节（见 FIGMA_SOURCE_LEDGER 缺口栏）。

import type { ReactNode } from 'react';

/** Figma `组织` 轴（5333:96）。 */
export type LcosCollectionOrganize = '事情' | '时间' | '未指定';
/** Figma `呈现` 轴（5333:96 / 5334:46）。 */
export type LcosCollectionRendition = '总览' | '主画布' | '装配' | '工作流现场';

export interface LcosCollectionSurfaceProps {
  readonly organize: LcosCollectionOrganize;
  readonly rendition: LcosCollectionRendition;
  readonly title: string;
  /** 第二行事实（成员数 / 最近更新）；由 producer 提供，不在这里编造。 */
  readonly meta?: string;
  readonly selected?: boolean;
  readonly onActivate?: () => void;
  /**
   * 兼容选择器（旧 Wave 脚本用 `[data-lcos-atlas-card]` 计数；R0 已知这些脚本未迁移新
   * harness，R2 新 e2e 上线后连同此属性一起删除）。取值是成员 kind，由调用方给真实值。
   */
  readonly legacyAtlasKind?: string;
  readonly children?: ReactNode;
  /** Production cards with nested actions render as a semantic container. */
  readonly renderAs?: 'button' | 'div';
}

export function LcosCollectionSurface({
  organize,
  rendition,
  title,
  meta,
  selected = false,
  onActivate,
  legacyAtlasKind,
  children,
  renderAs = 'button',
}: LcosCollectionSurfaceProps): React.JSX.Element {
  const content = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'inherit' }}>
        <span className="truncate">{title}</span>
      </span>
      {meta && <span className="text-[11px] opacity-70">{meta}</span>}
      <span data-lcos-collection-swatch className="grid place-items-center text-[11px] opacity-70">
        {rendition}
      </span>
      {children}
    </>
  );
  const attrs = {
    'data-lcos-family': 'collection-surface',
    'data-lcos-organize': organize,
    'data-lcos-variant': selected ? 'selected' : rendition,
    'data-lcos-rendition': rendition,
    ...(legacyAtlasKind ? { 'data-lcos-atlas-card': legacyAtlasKind } : {}),
    className: 'lcos-focus-ring',
  };
  if (renderAs === 'div') return <div {...attrs}>{content}</div>;
  return <button type="button" {...attrs} onClick={onActivate}>{content}</button>;
}
