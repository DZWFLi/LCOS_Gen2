// LCOS design tokens（Wave 0 从 token-style-component-manifest.json 导入；Oreo 浅色 + Dark Oreo 深色）.
// 值来源：Figma nFUdroLvI5qJZuYTW8h2rF unification/token-style-component-manifest.json（2026-09-13）。
// 禁止逐组件硬编码 hex；新增视觉先查本表。

import type { CSSProperties } from 'react';

export const lcosTokens = {
  color: {
    surface: { light: '#FFFFFF', dark: '#1F1F1F' },
    canvas: { light: '#FAFAFA', dark: '#0A0A0A' },
    raised: { light: '#F5F5F5', dark: '#262626' },
    text: { light: '#242626', dark: '#F5F5F5' },
    muted: { light: '#696F6B', dark: '#BDC4BE' },
    border: { light: '#E7E9E8', dark: '#383A3B' },
    borderSubtle: { light: 'rgba(0,0,0,0.09)', dark: 'rgba(255,255,255,0.11)' },
    borderDefault: { light: 'rgba(0,0,0,0.12)', dark: 'rgba(255,255,255,0.15)' },
    accent: { light: '#547464', dark: '#9BC0A8' },
    info: { light: '#107D98', dark: '#DFF7FA' },
    infoBg: { light: '#DEF8FA', dark: '#008889' },
    inverse: { light: '#202020', dark: '#FCFCFC' },
    textOnInverse: { light: '#FFFFFF', dark: '#000000' },
    pinViolet: '#6371DD',
    pinTeal: '#238E86',
    pinAmber: '#CE824C',
    danger: '#C25B4E',
  },
  radius: {
    control: 8,
    cardSmall: 12,
    cardMedium: 16,
    capsule: 999,
  },
  space: { x1: 2, x2: 4, x3: 6, x4: 8, x6: 12, x8: 16, x12: 24 },
  glass: {
    background: 'rgba(252,252,252,0.72)',
    blur: '18px',
    border: 'rgba(0,0,0,0.09)',
    shadow:
      '0 4px 12px rgba(40,48,58,0.075), 0 0 1px rgba(40,48,58,0.10)',
  },
  shadow: {
    default: '0 4px 16px rgba(0,0,0,0.04), 0 0 1px rgba(0,0,0,0.06)',
  },
  typography: {
    fontFamily: `'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
  },
  fontSize: { xs: 11, sm: 13, md: 14, lg: 16, title: 28, hero: 34 },
} as const;

/** 44px 最小热区（Wave 9 全量收口前先于交互组件落地）。 */
export const lcosHitArea: Readonly<{ min: number; padding: string }> = {
  min: 44,
  padding: '0 14px',
};

/** 玻璃浮动岛（LCOS / 通透玻璃 / HUD effect style 的 CSS 近似；manifest：radius4/refraction .28/双层阴影）。 */
export const lcosGlassStyle: CSSProperties = {
  background: lcosTokens.glass.background,
  backdropFilter: `blur(${lcosTokens.glass.blur}) saturate(1.4)`,
  WebkitBackdropFilter: `blur(${lcosTokens.glass.blur}) saturate(1.4)`,
  border: `1px solid ${lcosTokens.glass.border}`,
  borderRadius: 12,
  boxShadow: lcosTokens.glass.shadow,
};

export type LcosThemeMode = 'light' | 'dark';