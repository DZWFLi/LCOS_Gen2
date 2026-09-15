// LCOS design tokens —— 只导出语义引用，不复制同值常量。
//
// 渲染入口 = `huabu/apps/web/src/lcos/ui/lcos-tokens.css`（由 scripts/figma/gen-lcos-tokens.mjs
// 从 Figma nFUdroLvI5qJZuYTW8h2rF / unification/token-style-component-manifest.json 生成，
// 含 Oreo 浅色 + Dark Oreo 深色两套值）。本文件出现 hex/rgb 即视为回归（见 lcosTokens.test.ts）。
//
// 变量名出处：Figma codeSyntax.WEB（--gen2-* / --lcos-pin-*）或 manifest.suggestedCssAlias
// （--lcos-*）；对照表证据 docs/audit/GEN2_R1_token_map_20260914.json。

import type { CSSProperties } from 'react';

export const lcosTokens = {
  color: {
    // 节点场景（Gen2 / 节点场景，含浅/深两 mode）
    surface: 'var(--gen2-surface)',
    canvas: 'var(--gen2-canvas)',
    raised: 'var(--gen2-raised)',
    text: 'var(--gen2-text)',
    muted: 'var(--gen2-muted)',
    border: 'var(--gen2-border)',
    accent: 'var(--gen2-accent)',
    // Theme / Oreo
    borderSubtle: 'var(--lcos-color-border-subtle)',
    borderDefault: 'var(--lcos-color-border-default)',
    elevated: 'var(--lcos-surface-elevated)',
    info: 'var(--lcos-color-palette-blue-text)',
    infoBg: 'var(--lcos-color-palette-blue-bg)',
    inverse: 'var(--lcos-color-bg-inverse)',
    textOnInverse: 'var(--lcos-color-text-on-inverse)',
    // LCOS / 导航颜色（Pin 是颜色分组偏好，不是业务关系）
    pinViolet: 'var(--lcos-pin-violet)',
    pinTeal: 'var(--lcos-pin-teal)',
    pinAmber: 'var(--lcos-pin-amber)',
    // Figma manifest 无 danger 变量：在 lcos.css 显式声明为 LCOS 状态色（ledger honest remainder）
    danger: 'var(--lcos-status-danger)',
    mainPaper: 'var(--lcos-main-paper)',
    mainWaveActive: 'var(--lcos-main-wave-active)',
    mainWaveTail: 'var(--lcos-main-wave-tail)',
    mainMarkerAmber: 'var(--lcos-main-marker-amber)',
    mainMarkerGreen: 'var(--lcos-main-marker-green)',
    mainImageShadow: 'var(--lcos-main-image-shadow)',
    mainImageShadowSmall: 'var(--lcos-main-image-shadow-small)',
    mainPaperShadow: 'var(--lcos-main-paper-shadow)',
  },
  radius: {
    control: 'var(--lcos-radius-control)',
    cardSmall: 'var(--lcos-radius-card-small)',
    cardMedium: 'var(--lcos-radius-medium)',
    capsule: 'var(--lcos-radius-capsule)',
  },
  space: {
    x1: 'var(--lcos-space-x1)',
    x2: 'var(--lcos-space-x2)',
    x3: 'var(--lcos-space-x3)',
    x4: 'var(--lcos-space-8)',
    x6: 'var(--lcos-space-12)',
    x8: 'var(--lcos-space-16)',
    x12: 'var(--lcos-space-24)',
  },
  glass: {
    background: 'var(--lcos-glass-bg)',
    blur: 'var(--lcos-glass-blur)',
    border: 'var(--lcos-color-border-subtle)',
    shadow: 'var(--lcos-glass-shadow)',
  },
  shadow: {
    default: 'var(--lcos-shadow-default)',
  },
  actionOrb: {
    background: 'var(--lcos-action-orb-bg)',
    border: 'var(--lcos-action-orb-border)',
    shadow: 'var(--lcos-action-orb-shadow)',
  },
  typography: {
    fontFamily: `'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
    lineHeight: 'var(--lcos-line-height-12)',
  },
  // 字号阶梯无 Figma variable，是 LCOS 本地排版刻度（ledger：no Figma source）。
  fontSize: { xs: 11, sm: 13, md: 14, lg: 16, title: 28, hero: 34 },
} as const;

/** 44px 最小热区（设计规范：所有可点元素不低于 44×44）。 */
export const lcosHitArea: Readonly<{ min: number; padding: string }> = {
  min: 44,
  padding: '0 14px',
};

/** 玻璃浮动岛 = Figma EFFECT 样式「LCOS / 通透玻璃 / HUD」的 CSS 近似。 */
export const lcosGlassStyle: CSSProperties = {
  background: lcosTokens.glass.background,
  backdropFilter: `blur(${lcosTokens.glass.blur}) saturate(1.4)`,
  WebkitBackdropFilter: `blur(${lcosTokens.glass.blur}) saturate(1.4)`,
  border: `1px solid ${lcosTokens.glass.border}`,
  borderRadius: lcosTokens.radius.cardSmall,
  boxShadow: lcosTokens.glass.shadow,
};

export type LcosThemeMode = 'light' | 'dark';
