// R3 回归（static source guard）：Railway reorder 在 409 之后必须以
// 「fresh order + fresh graph 回读完成」作为解锁条件。
//
// 历史 bug：catch 内 `void refreshAfterConflict(previous)` + 紧接着的 finally 先
// setReordering(false)，用户在 fresh 投影回来前又能 reorder —— 那一次仍基于旧 version，
// 要么再撞 409，要么把并发期间新增的目的地顺序写坏。
//
// 浏览器端（dedicated Railway fixture）验证「409 → fresh order + 并发新目的地不丢」；
// 本 guard 锁住「await 与解锁同序」这条不变量，防止回归成 fire-and-forget。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'LcosRailway.tsx'), 'utf8');

describe('Railway reorder conflict lock（R3）', () => {
  it('409 分支必须 await conflict refresh，不得 fire-and-forget', () => {
    expect(
      /status === 409\)\s*\{[\s\S]{0,600}?await refreshAfterConflict\(previous\)/.test(SOURCE),
      '409 分支必须以 await refreshAfterConflict 结束',
    ).toBe(true);
    expect(/\bvoid refreshAfterConflict\(/.test(SOURCE), '禁止 void refreshAfterConflict').toBe(false);
  });

  it('解锁与 refresh 严格同序：finally 在 await 之后', () => {
    const awaited = SOURCE.indexOf('await refreshAfterConflict(previous)');
    const unlock = SOURCE.indexOf('finally(() => setReordering(false))');
    expect(awaited).toBeGreaterThan(-1);
    expect(unlock).toBeGreaterThan(awaited);
  });

  it('reordering 期间 reorder 入口保持锁定（drag 与 drop 双闸）', () => {
    expect(/draggable: destination\.available && !reordering/.test(SOURCE)).toBe(true);
    expect(/movedKey === destination\.key \|\| reordering\) return;/.test(SOURCE)).toBe(true);
  });
});