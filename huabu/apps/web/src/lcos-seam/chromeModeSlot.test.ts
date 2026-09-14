// R2 返工：旧壳退役策略的单测（哪个 chrome mode + 哪个节点类型才停挂载旧工具条）。
// 这条策略是"不删能力"红线的落点：只有命令已被 LCOS Arc 覆盖的类型才停挂载。

import { describe, expect, it } from 'vitest';

import { LCOS_STANDDOWN_TOOLBAR_TYPES, shouldStandDownLegacyNodeToolbar } from './chromeModeSlot';

describe('R2 旧壳退役策略', () => {
  it('huabu 模式下一律保留旧工具条', () => {
    for (const type of LCOS_STANDDOWN_TOOLBAR_TYPES) {
      expect(shouldStandDownLegacyNodeToolbar('huabu', type)).toBe(false);
    }
  });

  it('lcos 模式下已覆盖的类型停挂载', () => {
    for (const type of ['note', 'image', 'video', 'audio', 'canvasRef', 'nodeRef']) {
      expect(shouldStandDownLegacyNodeToolbar('lcos', type)).toBe(true);
    }
  });

  it('lcos 模式下未覆盖的类型继续挂旧工具条（避免删能力）', () => {
    // sketch=笔触控制、question=AI 运行/取消、frame=容器布局、text=原生自由文本格式、
    // pdf/office=下载（LCOS 未接线）、web=打开外链（LCOS 未接线）。
    for (const type of ['sketch', 'question', 'frame', 'text', 'pdf', 'office', 'web']) {
      expect(shouldStandDownLegacyNodeToolbar('lcos', type)).toBe(false);
    }
    for (const type of ['sketch', 'question', 'frame', 'text', 'pdf', 'office', 'web']) {
      expect(LCOS_STANDDOWN_TOOLBAR_TYPES.has(type)).toBe(false);
    }
  });
});
