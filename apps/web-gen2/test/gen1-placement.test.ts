// R2 落位测试（node:test，与 apps/web-gen2 既有测试同 runner）。
// 关键不是"能跑"，而是三条硬规则：
//   1. 新节点之间不重叠（含 gap）；
//   2. 新节点不与既有节点重叠（既有节点只读作障碍）；
//   3. 函数从不返回既有节点的调整位置 —— 老东西绝不动。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PLACEMENT_GAP,
  placeNewNodesIncrementally,
  placementOriginFor,
  type PlacementBounds,
} from '../src/spatial/gen1Placement.js';

const SIZE = { width: 280, height: 220 };

const overlaps = (a: PlacementBounds, b: PlacementBounds, gap = PLACEMENT_GAP): boolean =>
  !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );

test('R2 GEN1 落位：空画布新项彼此不重叠', () => {
  const points = placeNewNodesIncrementally([], [SIZE, SIZE, SIZE], { x: 0, y: 0 });
  assert.equal(points.length, 3);
  const boxes = points.map((p) => ({ ...p, ...SIZE }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(overlaps(boxes[i], boxes[j]), false, `#${i} 与 #${j} 重叠`);
    }
  }
});

test('R2 GEN1 落位：避开既有障碍（旧 index*40 级联的真实病灶）', () => {
  const existing: PlacementBounds[] = [
    { x: 0, y: 0, ...SIZE },
    { x: 40, y: 40, ...SIZE },
    { x: 80, y: 80, ...SIZE },
  ];
  const points = placeNewNodesIncrementally(existing, [SIZE], { x: 0, y: 0 });
  const candidate = { ...points[0], ...SIZE };
  for (const obstacle of existing) {
    assert.equal(overlaps(candidate, obstacle), false, '新节点仍与既有节点重叠');
  }
});

test('R2 GEN1 落位：既有节点绝不被移动（返回值只覆盖新项）', () => {
  const existing: PlacementBounds[] = [{ x: 0, y: 0, ...SIZE }];
  const snapshot = JSON.stringify(existing);
  const points = placeNewNodesIncrementally(existing, [SIZE, SIZE], { x: 0, y: 0 });
  assert.equal(points.length, 2);
  assert.equal(JSON.stringify(existing), snapshot);
});

test('R2 GEN1 落位：确定性（同输入两次结果一致）', () => {
  const existing: PlacementBounds[] = [{ x: 0, y: 0, ...SIZE }];
  const a = placeNewNodesIncrementally(existing, [SIZE, SIZE], { x: 0, y: 0 });
  const b = placeNewNodesIncrementally(existing, [SIZE, SIZE], { x: 0, y: 0 });
  assert.deepEqual(a, b);
});

test('R2 GEN1 落位：原点 = 既有内容右缘外侧；空画布回世界原点', () => {
  assert.deepEqual(placementOriginFor(null), { x: 0, y: 0 });
  assert.deepEqual(placementOriginFor({ x: 10, y: 20, width: 300, height: 100 }), {
    x: 10 + 300 + PLACEMENT_GAP,
    y: 20,
  });
});

test('R2 GEN1 落位：无新项时不返回位置', () => {
  assert.deepEqual(placeNewNodesIncrementally([{ x: 0, y: 0, ...SIZE }], [], { x: 0, y: 0 }), []);
});
