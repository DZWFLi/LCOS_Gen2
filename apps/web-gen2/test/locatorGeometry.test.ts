// T2 C2-3A · Locator pure geometry tests（卡 §55 矩阵）。
// target 在 safeRect 内 → LOCAL；近左/右/上/下边 → NEAR_EDGE；各边外 → EDGE
// 且 anchor 内缩；角部 → 稳定射线相交；safeRect 偏移原点 → 正确；右 dock 缩窄
// safeRect → edge 变化且 Camera 无关（纯几何无副作用）；浮动障碍不改 base
// safeRect（本模块只吃传入的 safeRect）；oversized target → 稳定状态；
// distance/progress 单调。

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeLocatorGeometry,
  toScreenRect,
  type ScreenRect,
} from '../src/spatial/locatorGeometry.js';

const SAFE: ScreenRect = { left: 0, top: 0, right: 1000, bottom: 800 };
const INSET = 16;
const NEAR = 120;

function geo(target: ScreenRect, safeRect: ScreenRect = SAFE) {
  return computeLocatorGeometry({ safeRect, targetRect: target, edgeInset: INSET, nearEdgeDistance: NEAR });
}

describe('locatorGeometry', () => {
  it('目标中心在舒适内区 → LOCAL，无 edgeAnchor，progress=0', () => {
    const g = geo({ left: 400, top: 300, right: 600, bottom: 500 });
    assert.equal(g.state, 'local');
    assert.equal(g.edgeAnchor, undefined);
    assert.equal(g.progress, 0);
  });

  it('目标贴近左边但仍完全在 safeRect 内 → NEAR_EDGE，方向指向左', () => {
    const g = geo({ left: 20, top: 300, right: 60, bottom: 500 });
    assert.equal(g.state, 'near-edge');
    assert.ok(g.direction.x < 0, `direction.x 应指向左，实际 ${g.direction.x}`);
    assert.ok(g.progress > 0 && g.progress <= 1);
  });

  it('目标贴近上边 → NEAR_EDGE，方向指向上', () => {
    const g = geo({ left: 400, top: 10, right: 600, bottom: 40 });
    assert.equal(g.state, 'near-edge');
    assert.ok(g.direction.y < 0);
  });

  it('目标中心在 safeRect 右侧外 → EDGE，edgeAnchor 停在右内缩边', () => {
    const g = geo({ left: 1100, top: 300, right: 1300, bottom: 500 });
    assert.equal(g.state, 'edge');
    assert.equal(g.progress, 1);
    assert.ok(g.edgeAnchor !== undefined);
    assert.equal(g.edgeAnchor.x, SAFE.right - INSET); // 右内缩边
    assert.ok(g.edgeAnchor.y > SAFE.top && g.edgeAnchor.y < SAFE.bottom);
    assert.ok(g.direction.x > 0);
  });

  it('目标中心在下边外 → EDGE，edgeAnchor 停在下内缩边', () => {
    const g = geo({ left: 400, top: 900, right: 600, bottom: 1100 });
    assert.equal(g.state, 'edge');
    assert.ok(g.edgeAnchor !== undefined);
    assert.equal(g.edgeAnchor.y, SAFE.bottom - INSET);
  });

  it('目标在左上角外 → EDGE，角部射线稳定（anchor 在左或上内缩边）', () => {
    const g = geo({ left: -500, top: -500, right: -300, bottom: -300 });
    assert.equal(g.state, 'edge');
    assert.ok(g.edgeAnchor !== undefined);
    const onLeftOrTop =
      Math.abs(g.edgeAnchor.x - SAFE.left - INSET) < 1e-6 ||
      Math.abs(g.edgeAnchor.y - SAFE.top - INSET) < 1e-6;
    assert.ok(onLeftOrTop, `anchor ${JSON.stringify(g.edgeAnchor)} 应在左上内缩边`);
  });

  it('safeRect 偏移到视口中部 → 几何仍以传入 safeRect 为准', () => {
    const offsetSafe: ScreenRect = { left: 300, top: 200, right: 1300, bottom: 1000 };
    const g = geo({ left: 1400, top: 500, right: 1600, bottom: 700 }, offsetSafe);
    assert.equal(g.state, 'edge');
    assert.ok(g.edgeAnchor !== undefined);
    assert.equal(g.edgeAnchor.x, offsetSafe.right - INSET);
  });

  it('右 dock 缩窄 safeRect → edge 锚点落在新右内缩边（Camera 无关：纯几何无副作用）', () => {
    const dockedSafe: ScreenRect = { left: 0, top: 0, right: 600, bottom: 800 };
    const g = geo({ left: 700, top: 300, right: 900, bottom: 500 }, dockedSafe);
    assert.equal(g.state, 'edge');
    assert.ok(g.edgeAnchor !== undefined);
    assert.equal(g.edgeAnchor.x, dockedSafe.right - INSET);
  });

  it('oversized target（大于 safeRect 但中心在内）→ 稳定状态，不打边缘标记', () => {
    const g = geo({ left: -200, top: -100, right: 1200, bottom: 900 });
    // 中心 (500,400) 在 safeRect 内
    assert.ok(g.state === 'local' || g.state === 'near-edge');
    assert.equal(g.edgeAnchor, undefined);
  });

  it('distance 单调：越远距离越大；EDGE 时 progress=1', () => {
    const near = geo({ left: 900, top: 300, right: 950, bottom: 500 });
    const far = geo({ left: 4000, top: 300, right: 4050, bottom: 500 });
    assert.ok(far.distance > near.distance);
    assert.equal(far.progress, 1);
  });

  it('目标中心恰好 = safeRect 中心 → LOCAL，direction 零向量', () => {
    const g = geo({ left: 450, top: 350, right: 550, bottom: 450 });
    assert.equal(g.state, 'local');
    assert.deepEqual(g.direction, { x: 0, y: 0 });
  });

  it('toScreenRect 转换 x/y/width/height → left/top/right/bottom', () => {
    assert.deepEqual(toScreenRect({ x: 10, y: 20, width: 100, height: 50 }), {
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
    });
  });
});
