#!/usr/bin/env node
/**
 * R1 token 生成器：Figma variables → LCOS CSS custom properties。
 *
 * 唯一输入：Figma 统一导出包 unification/token-style-component-manifest.json
 *   （fileKey nFUdroLvI5qJZuYTW8h2rF；exportedAt 见 manifest）。
 * 唯一产物：
 *   1. huabu/apps/web/src/lcos/ui/lcos-tokens.css —— 渲染入口（CSS 变量，双主题）
 *   2. docs/audit/GEN2_R1_token_map_20260914.json —— 机器可核对的映射证据
 *
 * 规则（对齐 12 号合同「CSS custom properties 才是渲染入口；TS 只导语义引用」）：
 *   - 变量名优先取 Figma codeSyntax.WEB（作者亲手写的真实别名），其次取 manifest
 *     给出的 suggestedCssAlias；两者都缺失即视为“无 Figma 依据”，脚本报错退出，
 *     不允许手编一个名字。
 *   - 颜色值一律取 resolvedValuesByMode（alias 链在浅/深两个 mode 常指向同一
 *     VariableID，只有 resolved 才是各主题真实值）。
 *   - 主题映射来自 manifest.collections 的 modeId → 浅色/深色。
 *
 * 用法：
 *   node scripts/figma/gen-lcos-tokens.mjs                 # 用默认设计包路径
 *   node scripts/figma/gen-lcos-tokens.mjs --check         # 只校验产物是否最新，不写盘
 *   FIGMA_MANIFEST=<path> node scripts/figma/gen-lcos-tokens.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const DEFAULT_MANIFEST =
  'E:/Codex 项目/OS开发/exports/LCOS_Figma_全设计包_20260913/unification/token-style-component-manifest.json';

const MANIFEST = process.env.FIGMA_MANIFEST || DEFAULT_MANIFEST;
const CSS_OUT = resolve(REPO, 'huabu/apps/web/src/lcos/ui/lcos-tokens.css');
const MAP_OUT = resolve(REPO, 'docs/audit/GEN2_R1_token_map_20260914.json');
const CHECK = process.argv.includes('--check');

/** modeId → 主题。manifest.collections 是权威来源，这里只做 ID→槽位归一。 */
const MODE_THEME = {
  '2:0': 'light', // Theme / Oreo
  '5:0': 'dark', // Theme / Dark Oreo
  '5037:0': 'light', // Gen2 / 节点场景 / 浅色
  '5037:1': 'dark', // Gen2 / 节点场景 / 深色
  '5393:0': 'both', // LCOS / 导航颜色（单 mode，与主题无关）
};

const fail = (msg) => {
  console.error(`[gen-lcos-tokens] 失败：${msg}`);
  process.exit(1);
};

if (!existsSync(MANIFEST)) fail(`找不到 Figma manifest：${MANIFEST}`);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const collectionsById = new Map((manifest.collections ?? []).map((c) => [c.id, c]));

/** 校验 manifest 的 collection/mode 结构仍与脚本假设一致；结构漂移要显式失败。 */
for (const [modeId, theme] of Object.entries(MODE_THEME)) {
  const owner = (manifest.collections ?? []).find((c) =>
    (c.modes ?? []).some((m) => m.modeId === modeId),
  );
  if (!owner) fail(`manifest 中不存在 modeId=${modeId}（脚本主题表过期）`);
  if (theme === 'both' && owner.modes.length !== 1) {
    fail(`modeId=${modeId} 所在 collection「${owner.name}」模式数不为 1，theme 判定需复核`);
  }
}

const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const colorToCss = ({ r, g, b, a }) => {
  const hex = `#${toHex(Math.round(r * 255))}${toHex(Math.round(g * 255))}${toHex(Math.round(b * 255))}`;
  if (a === undefined || a >= 1) return hex;
  const alpha = Number(a.toFixed(3));
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
};

/** codeSyntax.WEB 形如 "var(--gen2-canvas)"；返回变量名或 null。 */
const cssNameFromCodeSyntax = (v) => {
  const web = v.codeSyntax?.WEB;
  if (typeof web !== 'string') return null;
  const m = /var\(\s*(--[A-Za-z0-9_-]+)\s*\)/.exec(web);
  return m ? m[1] : null;
};

const unitFor = (v) => {
  if (v.scopes?.includes('CORNER_RADIUS')) return 'px';
  if (/^Space\//.test(v.name)) return 'px';
  if (/^line height\//i.test(v.name)) return 'px';
  return '';
};

const rows = [];
const unresolved = [];

for (const v of manifest.variables ?? []) {
  const fromCodeSyntax = cssNameFromCodeSyntax(v);
  const cssName = fromCodeSyntax ?? v.suggestedCssAlias ?? null;
  if (!cssName) unresolved.push(v.name);

  const themeValues = { light: null, dark: null, both: null };
  const modeThemesSeen = new Set();
  let themeScope = 'theme-collection';
  const modeIds = Object.keys(v.resolvedValuesByMode ?? {});
  const knownModes = modeIds.filter((m) => MODE_THEME[m]);
  // 外部库变量（remote，单 mode，collection 未随包导出）：与主题无关，进 :root。
  const librarySingleMode = v.remote === true && modeIds.length === 1 && knownModes.length === 0;
  for (const [modeId, raw] of Object.entries(v.resolvedValuesByMode ?? {})) {
    const theme = MODE_THEME[modeId] ?? (librarySingleMode ? 'both' : undefined);
    if (!theme) fail(`变量 ${v.name} 命中未知 modeId=${modeId}（既非主题集合，也非单 mode 外部库变量）`);
    if (librarySingleMode) themeScope = 'library-single-mode';
    modeThemesSeen.add(theme);
    const css =
      v.type === 'COLOR'
        ? colorToCss(raw)
        : `${raw}${unitFor(v)}`;
    if (theme === 'both') themeValues.both = css;
    else if (themeValues[theme] === null) themeValues[theme] = css;
  }

  if (v.type === 'COLOR' && themeValues.both === null) {
    if (themeValues.light === null || themeValues.dark === null) {
      fail(`颜色变量 ${v.name} 缺少浅色或深色值（无法建立双主题）`);
    }
  }

  rows.push({
    figmaVariableId: v.id,
    figmaName: v.name,
    collection: collectionsById.get(v.collectionId)?.name ?? v.collectionId,
    type: v.type,
    cssName,
    nameSource: fromCodeSyntax ? 'codeSyntax.WEB' : 'manifest.suggestedCssAlias',
    themeScope,
    light: themeValues.both ?? themeValues.light,
    dark: themeValues.both ?? themeValues.dark,
    valuesByMode: v.valuesByMode,
    resolvedValuesByMode: v.resolvedValuesByMode,
    scopes: v.scopes ?? [],
  });
}

if (unresolved.length > 0) {
  fail(`以下变量既无 codeSyntax 也无 suggestedCssAlias，禁止手编变量名：${unresolved.join(', ')}`);
}

if (rows.length === 0) fail('manifest.variables 为空');

/** 同值跨主题 → 只进 :root；否则 :root 浅色 + .dark 深色。 */
const rootOnly = rows.filter((r) => r.light === r.dark);
const themed = rows.filter((r) => r.light !== r.dark);

const line = (r) => `  ${r.cssName}: ${r.light};`;

/** Figma EFFECT 样式 → CSS。只取 CSS 可表达的 DROP_SHADOW；GLASS 的折射/深度无法用 CSS 表达，记入 limitations。 */
const shadowToCss = (e) => {
  const color = colorToCss(e.color);
  const { x = 0, y = 0 } = e.offset ?? {};
  const spread = e.spread ? ` ${e.spread}px` : '';
  return `${x}px ${y}px ${e.radius}px${spread} ${color}`;
};
const effectStyles = manifest.styles ?? [];
const effectByName = (n) => effectStyles.find((s) => s.name === n);
const glassStyle = effectByName('LCOS / 通透玻璃 / HUD');
const defaultShadowStyle = effectByName('Shadow/Default');
if (!glassStyle || !defaultShadowStyle) {
  fail('manifest.styles 缺少「LCOS / 通透玻璃 / HUD」或「Shadow/Default」EFFECT 样式');
}
const glassDropShadows = (glassStyle.effects ?? []).filter(
  (e) => e.type === 'DROP_SHADOW' && e.visible !== false,
);
const glassBlur = (glassStyle.effects ?? []).find((e) => e.type === 'GLASS');
if (glassDropShadows.length === 0 || !glassBlur) fail('「LCOS / 通透玻璃 / HUD」缺 GLASS 或可见 DROP_SHADOW');
const defaultShadow = (defaultShadowStyle.effects ?? []).filter(
  (e) => e.type === 'DROP_SHADOW' && e.visible !== false,
);
if (defaultShadow.length === 0) fail('「Shadow/Default」无可见 DROP_SHADOW');

const effectVars = [
  ['--lcos-glass-blur', `${glassBlur.radius}px`, `GLASS.radius（style「${glassStyle.name}」，refraction ${glassBlur.refraction}、depth ${glassBlur.depth} 无法用 CSS 表达）`],
  ['--lcos-glass-shadow', glassDropShadows.map(shadowToCss).join(', '), `「${glassStyle.name}」可见 DROP_SHADOW`],
  ['--lcos-shadow-default', defaultShadow.map(shadowToCss).join(', '), `「${defaultShadowStyle.name}」可见 DROP_SHADOW`],
];

const css = `/* 本文件由 scripts/figma/gen-lcos-tokens.mjs 生成，请勿手改。
 * 来源：Figma ${manifest.fileKey} / unification/token-style-component-manifest.json
 *       exportedAt ${manifest.exportedAt}
 * 变量名来源：codeSyntax.WEB 或 manifest.suggestedCssAlias（不手编）。
 * 这是 LCOS 前端颜色的唯一渲染入口；TS 侧只允许引用 var()，不得复制同值常量。 */

:root {
${rootOnly.map(line).join('\n')}
${rootOnly.length && themed.length ? '\n' : ''}${themed.map(line).join('\n')}
}

${
  themed.length
    ? `.dark {\n${themed.map((r) => `  ${r.cssName}: ${r.dark};`).join('\n')}\n}\n`
    : ''
}
/* EFFECT 样式（Figma styles / effectStyles） */
:root {
${effectVars.map(([n, v]) => `  ${n}: ${v};`).join('\n')}
}
`;

const mapJson = `${JSON.stringify(
  {
    generatedBy: 'scripts/figma/gen-lcos-tokens.mjs',
    source: MANIFEST,
    fileKey: manifest.fileKey,
    exportedAt: manifest.exportedAt,
    variableCount: rows.length,
    themedCount: themed.length,
    rootOnlyCount: rootOnly.length,
    effectStyles: (manifest.styles ?? []).map((s) => ({ name: s.name, key: s.key })),
    effectCssVars: Object.fromEntries(effectVars.map(([n, v, src]) => [n, { value: v, source: src }])),
    svgAssets: manifest.svgAssets ?? [],
    semanticCorrections: manifest.semanticCorrections ?? {},
    rows,
  },
  null,
  2,
)}\n`;

if (CHECK) {
  const stale = [];
  if (!existsSync(CSS_OUT) || readFileSync(CSS_OUT, 'utf8') !== css) stale.push(CSS_OUT);
  if (!existsSync(MAP_OUT) || readFileSync(MAP_OUT, 'utf8') !== mapJson) stale.push(MAP_OUT);
  if (stale.length) fail(`产物不是最新，请重新生成：\n  ${stale.join('\n  ')}`);
  console.log(`[gen-lcos-tokens] OK：${rows.length} 变量（themed ${themed.length}）产物最新`);
  process.exit(0);
}

mkdirSync(dirname(CSS_OUT), { recursive: true });
mkdirSync(dirname(MAP_OUT), { recursive: true });
writeFileSync(CSS_OUT, css, 'utf8');
writeFileSync(MAP_OUT, mapJson, 'utf8');

console.log(
  `[gen-lcos-tokens] 写出 ${rows.length} 个变量（双主题 ${themed.length} / 单主题 ${rootOnly.length}）`,
);
console.log(`  ${CSS_OUT}`);
console.log(`  ${MAP_OUT}`);
for (const r of rows) {
  console.log(`  ${r.cssName.padEnd(34)} ${r.light ?? ''}${r.light !== r.dark ? `  /  ${r.dark}` : ''}   [${r.nameSource}] ${r.figmaName}`);
}
