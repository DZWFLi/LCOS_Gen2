// Wave 9：LCOS 密度唯一来源——降级判定与节点数封顶（纯函数，无 React）。

import { describe, expect, it } from 'vitest';

import { capDensity, densityCapForNodeCount, densityFromZoom } from './useLcosDensity';

describe('densityFromZoom（无呈现上下文时的退化阶梯）', () => {
  it('按 zoom 分四档', () => {
    expect(densityFromZoom(0.1)).toBe('mark');
    expect(densityFromZoom(0.3)).toBe('summary');
    expect(densityFromZoom(0.7)).toBe('working');
    expect(densityFromZoom(1.2)).toBe('reading');
  });
});

describe('densityCapForNodeCount（80/150/300 档）', () => {
  it('150 及以下不封顶', () => {
    expect(densityCapForNodeCount(0)).toBeNull();
    expect(densityCapForNodeCount(80)).toBeNull();
    expect(densityCapForNodeCount(150)).toBeNull();
  });

  it('151–300 封到 working，301+ 封到 summary', () => {
    expect(densityCapForNodeCount(200)).toBe('working');
    expect(densityCapForNodeCount(300)).toBe('working');
    expect(densityCapForNodeCount(301)).toBe('summary');
  });
});

describe('capDensity（只压不升）', () => {
  it('高于封顶档才下降', () => {
    expect(capDensity('reading', 'working')).toBe('working');
    expect(capDensity('working', 'working')).toBe('working');
    expect(capDensity('mark', 'working')).toBe('mark');
    expect(capDensity('reading', null)).toBe('reading');
  });
});
