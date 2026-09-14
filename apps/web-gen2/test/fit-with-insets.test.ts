// 安全取景（fit with safe insets）测试（node:test，与 apps/web-gen2 既有测试同 runner）。
//
// 重点不是"能跑"，而是四条硬规则：
//   1. 空 / 非法 bounds 不出 NaN、不抛错，给确定的居中默认取景；
//   2. 可用区为负（超大 insets）时被夹到正数，仍不出负值 / NaN；
//   3. 内容很少时 zoom 不超过可读上限 1.25，绝不出现已定位病灶的 200%+ 巨字；
//   4. 内容过大时 zoom 落在 minZoom 上；x/y 基于"可用区"（视口 − insets）居中。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_FIT_MAX_ZOOM,
  DEFAULT_FIT_MIN_ZOOM,
  NO_INSETS,
  fitBoundsWithInsets,
  type ContentBounds,
  type FitResult,
  type SafeInsets,
} from '../src/spatial/fitWithInsets.js';

/** 断言结果三值都是有限数（禁 NaN / Infinity）。 */
const assertFinite = (result: FitResult): void => {
  assert.ok(Number.isFinite(result.x), `x 非有限：${result.x}`);
  assert.ok(Number.isFinite(result.y), `y 非有限：${result.y}`);
  assert.ok(Number.isFinite(result.zoom), `zoom 非有限：${result.zoom}`);
  assert.ok(result.zoom > 0, `zoom 必须为正：${result.zoom}`);
};

test('安全取景：空 bounds（null）→ 确定的居中默认取景 zoom = 1', () => {
  const result = fitBoundsWithInsets(null, { width: 900, height: 720 }, NO_INSETS);
  assertFinite(result);
  assert.deepEqual(result, { x: 450, y: 360, zoom: 1 });
});

test('安全取景：非正 / 非有限宽高的 bounds 走同一默认，不出 NaN', () => {
  const viewport = { width: 900, height: 720 };
  const expected = { x: 450, y: 360, zoom: 1 };
  for (const bounds of [
    { x: 10, y: 10, width: 0, height: 50 },
    { x: 10, y: 10, width: 50, height: 0 },
    { x: 10, y: 10, width: -20, height: 80 },
    { x: Number.NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
  ] satisfies ContentBounds[]) {
    const result = fitBoundsWithInsets(bounds, viewport, NO_INSETS);
    assertFinite(result);
    assert.deepEqual(result, expected, `bounds=${JSON.stringify(bounds)}`);
  }
});

test('安全取景：可用区为负（超大 insets）→ 夹到正数，结果仍确定且无 NaN', () => {
  const insets: SafeInsets = { left: 900, right: 100, top: 500, bottom: 100 };
  const result = fitBoundsWithInsets(
    { x: 0, y: 0, width: 100, height: 100 },
    { width: 800, height: 600 },
    insets,
  );
  assertFinite(result);
  // 可用区被夹到 1×1（不是 -200×0）：内区 1×1 → 原样 zoom = 0.01 → 落到 minZoom。
  assert.equal(result.zoom, DEFAULT_FIT_MIN_ZOOM);
  // 可用区中心 = insets.left / insets.top + 1/2；内容中心 (50,50) 正好映射到那里。
  const worldCenter = { x: 50, y: 50 };
  assert.equal(result.x + worldCenter.x * result.zoom, 900.5);
  assert.equal(result.y + worldCenter.y * result.zoom, 500.5);
});

test('安全取景：视口为 0×0 → 可用区夹到 1×1，不产生 NaN', () => {
  const result = fitBoundsWithInsets(
    { x: 0, y: 0, width: 200, height: 200 },
    { width: 0, height: 0 },
    NO_INSETS,
  );
  assertFinite(result);
  assert.equal(result.zoom, DEFAULT_FIT_MIN_ZOOM);
});

test('安全取景：内容很小 → zoom 停在可读上限 1.25，绝不是 200%+ 巨字', () => {
  // GEN1 同款用例（apps/web/tests/canvasGeometry.test.ts:19）：单个小节点在 1366×768 上
  // 曾会被吹到 200%+，GEN1 的可读模式把上限定在 1.25。
  const single = fitBoundsWithInsets({ x: 0, y: 0, width: 264, height: 190 }, { width: 1366, height: 768 }, NO_INSETS);
  assert.equal(single.zoom, DEFAULT_FIT_MAX_ZOOM);
  assert.equal(DEFAULT_FIT_MAX_ZOOM, 1.25);
  assert.ok(DEFAULT_FIT_MAX_ZOOM < 1.5, '默认可读上限必须明显低于 1.5');

  const tiny: ContentBounds = { x: 40, y: 40, width: 100, height: 60 };
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 800, height: 600 },
    { width: 3440, height: 1440 },
  ]) {
    const result = fitBoundsWithInsets(tiny, viewport, NO_INSETS);
    assertFinite(result);
    assert.ok(result.zoom <= DEFAULT_FIT_MAX_ZOOM, `${viewport.width}×${viewport.height} → ${result.zoom}`);
    assert.ok(result.zoom < 2, '不得回到 200% 以上的不可读取景');
  }
});

test('安全取景：内容很大 → zoom 被 minZoom 夹住；显式 minZoom 覆盖生效', () => {
  const viewport = { width: 1200, height: 800 };
  const huge: ContentBounds = { x: 0, y: 0, width: 12000, height: 8000 };

  const clamped = fitBoundsWithInsets(huge, viewport, NO_INSETS);
  assertFinite(clamped);
  assert.equal(clamped.zoom, DEFAULT_FIT_MIN_ZOOM);

  // 不设下限时：内区 (1200-148) × (800-148) → zoom = 652 / 8000。
  const overview = fitBoundsWithInsets(huge, viewport, NO_INSETS, { minZoom: 0.05 });
  assertFinite(overview);
  assert.equal(overview.zoom, 652 / 8000);
});

test('安全取景：x / y 让内容中心落在可用区中心', () => {
  const viewport = { width: 900, height: 700 };
  const bounds: ContentBounds = { x: 500, y: -300, width: 200, height: 200 };
  const result = fitBoundsWithInsets(bounds, viewport, NO_INSETS);
  assertFinite(result);

  const worldCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  assert.equal(result.x + worldCenter.x * result.zoom, viewport.width / 2);
  assert.equal(result.y + worldCenter.y * result.zoom, viewport.height / 2);
});

test('安全取景：insets 不对称时基于可用区居中（不是视口中心）', () => {
  const viewport = { width: 1000, height: 800 };
  const insets: SafeInsets = { left: 300, right: 100, top: 0, bottom: 200 };
  // 内容中心正好在世界原点，便于直接读平移量。
  const result = fitBoundsWithInsets({ x: -50, y: -50, width: 100, height: 100 }, viewport, insets);
  assertFinite(result);

  // 可用区 600×600：左边让出 300（中心 600），上面不让位、下面让出 200（中心 300）。
  assert.equal(result.x, 600);
  assert.equal(result.y, 300);
  assert.notEqual(result.x, viewport.width / 2);
  assert.notEqual(result.y, viewport.height / 2);
});

test('安全取景：padding 与 maxZoom 选项生效（保留 GEN1 的总览放大能力）', () => {
  const viewport = { width: 900, height: 700 };
  const bounds: ContentBounds = { x: 0, y: 0, width: 400, height: 400 };

  assert.equal(fitBoundsWithInsets(bounds, viewport, NO_INSETS, { padding: 0, maxZoom: 5 }).zoom, 700 / 400);
  assert.equal(fitBoundsWithInsets(bounds, viewport, NO_INSETS, { padding: 74, maxZoom: 5 }).zoom, 552 / 400);

  const overview = fitBoundsWithInsets({ x: 0, y: 0, width: 264, height: 190 }, { width: 1366, height: 768 }, NO_INSETS, { maxZoom: 2 });
  assert.equal(overview.zoom, 2);
});

test('安全取景：负 insets 视为 0', () => {
  const viewport = { width: 900, height: 700 };
  const bounds: ContentBounds = { x: 10, y: 20, width: 300, height: 200 };
  const negative: SafeInsets = { left: -50, right: -50, top: -50, bottom: -50 };
  assert.deepEqual(
    fitBoundsWithInsets(bounds, viewport, negative),
    fitBoundsWithInsets(bounds, viewport, NO_INSETS),
  );
});

test('安全取景：纯函数 —— 不改输入、同输入两次结果一致', () => {
  const bounds = Object.freeze({ x: 12, y: 34, width: 300, height: 200 });
  const viewport = Object.freeze({ width: 900, height: 700 });
  const insets = Object.freeze({ left: 76, right: 28, top: 24, bottom: 60 });
  const options = Object.freeze({ minZoom: 0.3, maxZoom: 1.1, padding: 48 });

  const first = fitBoundsWithInsets(bounds, viewport, insets, options);
  const second = fitBoundsWithInsets(bounds, viewport, insets, options);
  assertFinite(first);
  assert.deepEqual(first, second);
  assert.deepEqual(bounds, { x: 12, y: 34, width: 300, height: 200 });
  assert.deepEqual(viewport, { width: 900, height: 700 });
  assert.deepEqual(insets, { left: 76, right: 28, top: 24, bottom: 60 });
});
