// T2 C2-3A · Locator / Arrival reducer tests（卡 §56 矩阵）。
// idle→travelling；travelling→arriving；arriving→settled(idle)；新代取消旧代；
// project/canvas 切换 cancel；同代重复点击 no-op；reduced-motion 语义路径不变。

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  initialLocatorState,
  reduceLocatorState,
} from '../src/interaction/locatorState.js';
import {
  initialArrivalState,
  reduceArrivalState,
} from '../src/interaction/arrivalState.js';

describe('locatorState reducer', () => {
  it('初始 hidden', () => {
    assert.equal(initialLocatorState.phase, 'hidden');
  });

  it('geometry 喂入 local/near-edge/edge', () => {
    let s = initialLocatorState;
    s = reduceLocatorState(s, { type: 'geometry', phase: 'local' });
    assert.equal(s.phase, 'local');
    s = reduceLocatorState(s, { type: 'geometry', phase: 'near-edge' });
    assert.equal(s.phase, 'near-edge');
    s = reduceLocatorState(s, { type: 'geometry', phase: 'edge' });
    assert.equal(s.phase, 'edge');
  });

  it('locate-requested → travelling；camera-settled → arriving；arrival-done → hidden', () => {
    let s = reduceLocatorState(initialLocatorState, { type: 'locate-requested' });
    assert.equal(s.phase, 'travelling');
    s = reduceLocatorState(s, { type: 'camera-settled' });
    assert.equal(s.phase, 'arriving');
    s = reduceLocatorState(s, { type: 'arrival-done' });
    assert.equal(s.phase, 'hidden');
  });

  it('同代 travelling 中重复 locate-requested → no-op（C2-3 §48）', () => {
    let s = reduceLocatorState(initialLocatorState, { type: 'locate-requested' });
    s = reduceLocatorState(s, { type: 'locate-requested' });
    assert.equal(s.phase, 'travelling');
  });

  it('travelling 中 geometry 不打断展示相位', () => {
    let s = reduceLocatorState(initialLocatorState, { type: 'locate-requested' });
    s = reduceLocatorState(s, { type: 'geometry', phase: 'edge' });
    assert.equal(s.phase, 'travelling');
  });

  it('target-unavailable → unavailable；cancel/target-gone → hidden', () => {
    assert.equal(reduceLocatorState(initialLocatorState, { type: 'target-unavailable' }).phase, 'unavailable');
    assert.equal(reduceLocatorState(initialLocatorState, { type: 'cancel' }).phase, 'hidden');
    assert.equal(reduceLocatorState(initialLocatorState, { type: 'target-gone' }).phase, 'hidden');
  });
});

describe('arrivalState reducer', () => {
  it('初始 idle；travel-start → travelling；camera-settled → arriving；arrival-complete → idle', () => {
    assert.equal(initialArrivalState.phase, 'idle');
    let s = reduceArrivalState(initialArrivalState, { type: 'travel-start' });
    assert.equal(s.phase, 'travelling');
    s = reduceArrivalState(s, { type: 'camera-settled' });
    assert.equal(s.phase, 'arriving');
    s = reduceArrivalState(s, { type: 'arrival-complete' });
    assert.equal(s.phase, 'idle');
  });

  it('新代 cancel → cancelled（project/canvas 切换也走 cancel）', () => {
    const s = reduceArrivalState({ phase: 'arriving' }, { type: 'cancel' });
    assert.equal(s.phase, 'cancelled');
  });

  it('reduced-motion 语义路径不变：camera-settled 仍 → arriving', () => {
    const s = reduceArrivalState({ phase: 'travelling' }, { type: 'camera-settled' });
    assert.equal(s.phase, 'arriving');
  });

  it('非 travelling 时 camera-settled 是 no-op', () => {
    assert.equal(reduceArrivalState(initialArrivalState, { type: 'camera-settled' }).phase, 'idle');
  });
});
