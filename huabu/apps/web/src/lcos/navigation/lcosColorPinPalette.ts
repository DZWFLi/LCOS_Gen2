// R6 ColorPin：颜色组调色板的单一来源。
//
// Core 只接受 canonical `#RRGGBB`（color-pin 契约 V0）。调色板值的唯一来源是设计
// token CSS（`--lcos-pin-*`，由 Figma 生成器产出）——运行时读取，不在 TS 里复制 hex
// （lcosTokens.test.ts 的 token 回归规则）。读不到变量 = 拿不到 canonical 颜色
// → 诚实不可用，绝不猜一个近似色写进 Core。

import { lcosTokens } from '../ui/lcosTokens';

export type LcosColorPinTone = 'violet' | 'teal' | 'amber';

/** tone → 设计 token 变量（hex 的唯一来源仍是 lcos-tokens.css）。 */
export const LCOS_COLOR_PIN_TOKENS: Readonly<Record<LcosColorPinTone, string>> = {
  violet: lcosTokens.color.pinViolet,
  teal: lcosTokens.color.pinTeal,
  amber: lcosTokens.color.pinAmber,
};

const TONES: readonly LcosColorPinTone[] = ['violet', 'teal', 'amber'];
const HEX_RE = /^#[0-9A-F]{6}$/;

/**
 * `lcosTokens` 给的是引用（`var(--lcos-pin-violet)`），而 `getPropertyValue` 必须拿
 * 变量名（`--lcos-pin-violet`）——这里从同一个引用里取名字，不复制变量名常量。
 */
function cssVarNameOf(reference: string): string {
  return /^var\((--[A-Za-z0-9-]+)\)$/.exec(reference.trim())?.[1] ?? reference.trim();
}

/**
 * 从设计 token CSS 变量解析调色板。
 * 任一变量缺失或不是 `#RRGGBB` → undefined（调用方必须按不可用处理，不得回退近似色）。
 */
export function readColorPinPaletteV1(
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): Readonly<Record<LcosColorPinTone, string>> | undefined {
  if (doc === undefined) return undefined;
  const styles = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (styles === undefined) return undefined;
  const resolved = {} as Record<LcosColorPinTone, string>;
  for (const tone of TONES) {
    const value = styles.getPropertyValue(cssVarNameOf(LCOS_COLOR_PIN_TOKENS[tone])).trim().toUpperCase();
    if (!HEX_RE.test(value)) return undefined;
    resolved[tone] = value;
  }
  return resolved;
}

function rgbOf(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * 呈现口径：canonical 颜色 → 冻结的 3-tone 家族轴（精确匹配优先，否则最接近）。
 * tone 只是 CSS 家族轴；真实颜色始终按 canonical 值渲染（不替换、不改写）。
 */
export function toneForColorPinV1(
  color: string,
  palette: Readonly<Record<LcosColorPinTone, string>>,
): LcosColorPinTone {
  const needle = color.trim().toUpperCase();
  for (const tone of TONES) if (palette[tone] === needle) return tone;
  if (!HEX_RE.test(needle)) return 'violet';
  const [r, g, b] = rgbOf(needle);
  let best: LcosColorPinTone = 'violet';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tone of TONES) {
    const [tr, tg, tb] = rgbOf(palette[tone]);
    const distance = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tone;
    }
  }
  return best;
}

/** tone 家族轴 → 用于 CSS 变体；调色板本身由 canonical 颜色驱动。 */
export function paletteTonesV1(): readonly LcosColorPinTone[] {
  return TONES;
}