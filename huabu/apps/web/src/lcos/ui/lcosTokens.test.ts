// R1 token 层 fail-fast 测试：
// 1) lcosTokens.ts 只允许出现 var() 语义引用——出现 hex/rgb 常量即回归（= 复制同值常量）；
// 2) lcosTokens.ts 引用的每个 CSS 变量都必须在生成的 lcos-tokens.css（或 LCOS 本地 token 的
//    lcos.css）里真的被定义——防「引用了一个不存在的变量」导致整块样式静默变空。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULE_DIR = (import.meta as unknown as { dirname?: string }).dirname ?? process.cwd();
const read = (rel: string): string => readFileSync(resolve(MODULE_DIR, rel), 'utf8');
const REPO_ROOT = resolve(MODULE_DIR, '..', '..', '..', '..', '..', '..');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TOKENS_TS = read('./lcosTokens.ts');
const GENERATED_CSS = read('./lcos-tokens.css');
const LOCAL_CSS = read('./lcos.css');

describe('R1 token 层', () => {
  it('lcosTokens.ts 不含颜色字面量（hex / rgb / rgba / hsl）', () => {
    const code = stripComments(TOKENS_TS);
    const found = code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
    expect(found).toEqual([]);
  });

  it('lcosTokens.ts 引用的每个 CSS 变量都有真实定义', () => {
    const code = stripComments(TOKENS_TS);
    const referenced = Array.from(code.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g)).map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(10);

    const defined = new Set(
      Array.from(`${GENERATED_CSS}\n${LOCAL_CSS}`.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)).map((m) => m[1]),
    );
    const missing = referenced.filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it('生成文件确实带 Figma 的双主题值（浅色 + Dark Oreo）', () => {
    const dark = /\.dark\s*\{([\s\S]*?)\}/.exec(GENERATED_CSS)?.[1] ?? '';
    expect(dark).toContain('--gen2-canvas');
    expect(dark).toContain('--gen2-surface');
    const root = /:root\s*\{([\s\S]*?)\}/.exec(GENERATED_CSS)?.[1] ?? '';
    expect(root).toContain('--gen2-canvas');
    // 两个主题必须是不同的值，否则等于没做主题。
    const lightCanvas = /--gen2-canvas:\s*([^;]+);/.exec(root)?.[1]?.trim();
    const darkCanvas = /--gen2-canvas:\s*([^;]+);/.exec(dark)?.[1]?.trim();
    expect(lightCanvas).toBeTruthy();
    expect(darkCanvas).toBeTruthy();
    expect(lightCanvas).not.toBe(darkCanvas);
  });

  it('生成的 CSS 与 R1 映射证据（token map）逐条一致', () => {
    // 两份都是**已提交的产物**：这条断言防「只改了其中一份」的漂移。
    const map = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'docs/audit/GEN2_R1_token_map_20260914.json'), 'utf8'),
    ) as {
      rows: { cssName: string; light: string; dark: string }[];
      effectCssVars: Record<string, { value: string }>;
    };
    expect(map.rows.length).toBe(32);
    const rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(GENERATED_CSS)?.[1] ?? '';
    const darkBlock = /\.dark\s*\{([\s\S]*?)\}/.exec(GENERATED_CSS)?.[1] ?? '';
    for (const row of map.rows) {
      expect(rootBlock, `:root 缺 ${row.cssName}`).toContain(`${row.cssName}: ${row.light};`);
      if (row.light !== row.dark) {
        // 只有真正随主题变化的变量才应出现在 .dark；同值变量留在 :root（不重复声明）。
        expect(darkBlock, `.dark 缺 ${row.cssName}`).toContain(`${row.cssName}: ${row.dark};`);
      }
    }
    for (const [name, { value }] of Object.entries(map.effectCssVars)) {
      expect(GENERATED_CSS).toContain(`${name}: ${value};`);
    }
  });
});
