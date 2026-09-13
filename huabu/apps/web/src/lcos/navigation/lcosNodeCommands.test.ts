// R2 T3 命令表测试：菜单只写真实事实，缺口照样列出并写明原因（不隐藏、不假装可用）。

import { describe, expect, it } from 'vitest';

import { buildLcosNodeCommands, resolveOpenCommand } from './lcosNodeCommands';

const byId = (commands: ReturnType<typeof buildLcosNodeCommands>, id: string) =>
  commands.find((c) => c.id === id);

describe('R2 节点命令表', () => {
  it('会话节点：打开工作台可用；未绑定节点：打开被禁用并说明原因', () => {
    const conversation = buildLcosNodeCommands({
      nodeType: 'note',
      entityType: 'conversation',
      entityId: 'c1',
      referenced: false,
    });
    expect(byId(conversation, 'open')?.disabledReason).toBeUndefined();
    expect(byId(conversation, 'open')?.label).toBe('打开会话工作台');

    const unbound = buildLcosNodeCommands({ nodeType: 'note', referenced: false });
    expect(byId(unbound, 'open')?.disabledReason).toBe('该节点未绑定 Core 实体');
    expect(byId(unbound, 'reference')?.disabledReason).toBe('该节点未绑定 Core 实体，无法建立引用');
    // 未绑定 → 可以真的删除（不是投影）
    expect(byId(unbound, 'delete')?.disabledReason).toBeUndefined();
  });

  it('已绑定节点不允许"删除"（删了 reconcile 会重新出现），并给出真实原因', () => {
    const commands = buildLcosNodeCommands({
      nodeType: 'note',
      entityType: 'artifact',
      entityId: 'a1',
      referenced: false,
    });
    expect(byId(commands, 'delete')?.disabledReason).toContain('Core 投影');
  });

  it('文本/笔记互转只在两者之间可用', () => {
    const text = buildLcosNodeCommands({ nodeType: 'text', referenced: false });
    expect(byId(text, 'convert-note')?.disabledReason).toBeUndefined();
    expect(byId(text, 'convert-text')).toBeUndefined();

    const image = buildLcosNodeCommands({ nodeType: 'image', referenced: false });
    expect(byId(image, 'convert-text')?.disabledReason).toBe('只有 文本/笔记 之间可转换');
  });

  it('引用命令反映真实草稿状态', () => {
    const referenced = buildLcosNodeCommands({
      nodeType: 'note',
      entityType: 'artifact',
      entityId: 'a1',
      referenced: true,
    });
    expect(byId(referenced, 'reference')?.label).toBe('取消引用（Composer 草稿）');
  });

  it('未接线命令一律显式标注 GAP（旧工具条仍覆盖，本轮不退役）', () => {
    const commands = buildLcosNodeCommands({ nodeType: 'note', referenced: false });
    const gaps = commands.filter((c) => c.group === '未接线');
    expect(gaps.map((c) => c.id)).toEqual(['accent', 'size', 'text-format', 'run']);
    for (const gap of gaps) {
      expect(gap.disabledReason).toBe('尚未接线（GAP）');
    }
  });

  it('原生入口节点：没有目标现场时如实说没有绑定', () => {
    expect(resolveOpenCommand({ nodeType: 'canvasRef', referenced: false }).disabledReason).toBe(
      '该入口没有绑定目标（未绑定现场）',
    );
    expect(
      resolveOpenCommand({ nodeType: 'canvasRef', targetCanvasId: 'c-9', referenced: false }).disabledReason,
    ).toBeUndefined();
  });
});
