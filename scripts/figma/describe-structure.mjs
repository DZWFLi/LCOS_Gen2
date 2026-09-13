#!/usr/bin/env node
/**
 * Figma 结构速览：把 unification/structures/<name>/nodes-*.json 打印成可读树。
 *
 * 用途：R1+ 建组件族时取「exact node/component/variant」的真实几何与文本，
 * 避免看 PNG 后自己猜；也用于 FIGMA_SOURCE_LEDGER 的证据摘录。
 *
 * 用法：
 *   node scripts/figma/describe-structure.mjs <name> [--name <regex>] [--depth N] [--json]
 * 例：
 *   node scripts/figma/describe-structure.mjs railway
 *   node scripts/figma/describe-structure.mjs navigator --name "状态=静息" --depth 4
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PKG =
  process.env.FIGMA_PACKAGE ||
  'E:/Codex 项目/OS开发/exports/LCOS_Figma_全设计包_20260913/unification';

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
const opt = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const nameFilter = opt('--name', null);
const maxDepth = Number(opt('--depth', '3'));
const asJson = argv.includes('--json');

if (!name) {
  const dir = join(PKG, 'structures');
  console.error('用法: node scripts/figma/describe-structure.mjs <name> [--name <regex>] [--depth N] [--json]');
  console.error(`可用: ${existsSync(dir) ? readdirSync(dir).join(', ') : '(结构目录缺失)'}`);
  process.exit(1);
}

const dir = join(PKG, 'structures', name);
if (!existsSync(dir)) {
  console.error(`找不到结构目录：${dir}`);
  process.exit(1);
}

const raw = [];
for (const f of readdirSync(dir).filter((f) => /^nodes-\d+\.json$/.test(f)).sort()) {
  const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  raw.push(...(Array.isArray(parsed) ? parsed : (parsed.nodes ?? [])));
}

const byId = new Map(raw.map((n) => [n.id ?? n.nodeId, n]));
/** 结构包用 parentId 表达层级（不是 children 数组）。 */
const childIndex = new Map();
for (const n of raw) {
  const pid = n.parentId;
  if (!pid) continue;
  if (!childIndex.has(pid)) childIndex.set(pid, []);
  childIndex.get(pid).push(n);
}
const childrenOf = (id) =>
  childIndex.get(id) ?? (byId.get(id)?.children ?? []).map((c) => byId.get(c)).filter(Boolean);

const rootIds = raw
  .map((n) => n.id ?? n.nodeId)
  .filter((id) => {
    const n = byId.get(id);
    return !n.parentId || !byId.has(n.parentId);
  });

const box = (n) => {
  const b = n.absoluteBoundingBox ?? n.absoluteRenderBounds ?? n.boundingBox ?? {};
  const w = Math.round(b.width ?? n.width ?? 0);
  const h = Math.round(b.height ?? n.height ?? 0);
  return `${w}×${h}`;
};
const text = (n) => {
  const chars = n.characters ?? n.name;
  return typeof chars === 'string' ? chars.replace(/\s+/g, ' ').slice(0, 40) : '';
};

const layout = (n) => {
  if (!n.layoutMode || n.layoutMode === 'NONE') return '';
  const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft];
  const padTxt = pad.every((p) => !p) ? '' : ` pad=${pad.join('/')}`;
  const gap = n.itemSpacing ? ` gap=${n.itemSpacing}` : '';
  const align = `${n.primaryAxisAlignItems ?? ''}/${n.counterAxisAlignItems ?? ''}`.replace(/^\/|\/$/g, '');
  return ` {${n.layoutMode}${padTxt}${gap}${align ? ` ${align}` : ''}}`;
};
const style = (n) => {
  const bits = [];
  if (n.cornerRadius) bits.push(`r=${n.cornerRadius}`);
  const fill = n.fills?.[0];
  if (fill?.color) {
    const c = fill.color;
    const hex = `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
    bits.push(`fill=${hex}${fill.opacity !== undefined && fill.opacity < 1 ? `@${Number(fill.opacity.toFixed(2))}` : ''}`);
  }
  if (n.boundVariables && Object.keys(n.boundVariables).length) {
    bits.push(`bind=${Object.keys(n.boundVariables).join(',')}`);
  }
  return bits.length ? `  ${bits.join(' ')}` : '';
};

const lines = [];
const walk = (n, depth, pathText) => {
  if (!n) return;
  const id = n.id ?? n.nodeId;
  const pad = '  '.repeat(depth);
  const label = `${n.name ?? n.type ?? '?'}`;
  const t = n.type === 'TEXT' ? `  "${text(n)}"` : '';
  lines.push(`${pad}${label}  [${box(n)}]  ${id}${layout(n)}${style(n)}${t}  ${pathText}`);
  if (depth >= maxDepth) return;
  for (const c of childrenOf(id)) walk(c, depth + 1, pathText);
};

const match = (n) => !nameFilter || new RegExp(nameFilter).test(n.name ?? '');

const jsonOut = [];
if (nameFilter) {
  // 命中即可，不必是 root：从每个命中节点向下展开
  for (const n of raw) {
    if (!match(n)) continue;
    walk(n, 0, '');
    jsonOut.push({ id: n.id ?? n.nodeId, name: n.name, type: n.type, box: box(n) });
    lines.push('');
  }
} else {
  for (const id of rootIds) {
    const root = byId.get(id);
    jsonOut.push({ id, name: root.name, type: root.type, box: box(root) });
    walk(root, 0, '');
  }
}

if (asJson) {
  console.log(JSON.stringify(jsonOut, null, 2));
} else {
  console.log(`# structures/${name}  nodes=${raw.length}  roots=${rootIds.length}`);
  if (lines.length === 0) console.log('（无匹配；去掉 --name 再试）');
  console.log(lines.join('\n'));
}

if (!existsSync(join(REPO, 'huabu'))) process.exit(1);
