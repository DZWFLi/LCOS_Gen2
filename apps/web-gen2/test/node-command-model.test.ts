// R2 返工：节点命令模型测试（node:test，与 apps/web-gen2 既有 runner 一致）。
// 四条纪律在这里被钉住：
//   1. 不适用（该类型旧工具条没有这个控件）的动作**不出现**，不做假按钮；
//   2. 不可用动作必须给**真实原因**，且绝不出现 "尚未接线（GAP）" 这类占位；
//   3. 覆盖关系表驱动：表外类型返回空数组（继续挂旧壳），不在这里瞎给命令；
//   4. Core 投影的"删除"必须说清它会被重新投影，而不是假装删掉。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildLcosNodeCommands,
  primaryNodeCommands,
  type LcosNodeCommand,
  type LcosNodeCommandInput,
} from '../src/interaction/nodeCommandModel.js';

const base: LcosNodeCommandInput = { nodeType: 'note', capabilities: [], referenced: false };

const byId = (commands: readonly LcosNodeCommand[], id: string) => commands.find((c) => c.id === id);
const idsOf = (commands: readonly LcosNodeCommand[]) => commands.map((c) => String(c.id));

test('R2 命令模型：无任何 "尚未接线（GAP）" 占位，也不再有 "未接线" 分组', () => {
  const commands = buildLcosNodeCommands({
    nodeType: 'note',
    entityType: 'artifact',
    entityId: 'a1',
    capabilities: ['place', 'reference', 'edit'],
    referenced: false,
    noteHeightMode: 'fixed',
  });
  assert.equal(
    commands.some((c) => c.disabledReason === '尚未接线（GAP）'),
    false,
  );
  assert.equal(
    commands.some((c) => String(c.group) === '未接线'),
    false,
  );
  // 每条命令都必须有非空 label / group
  for (const command of commands) {
    assert.ok(command.label.length > 0, `${command.id} 缺 label`);
    assert.ok(command.group.length > 0, `${command.id} 缺 group`);
  }
});

test('R2 命令模型：note + 已绑定 Core（含 reference 能力）近场给出 打开/引用/自动高度', () => {
  const commands = buildLcosNodeCommands({
    nodeType: 'note',
    entityType: 'artifact',
    entityId: 'a1',
    capabilities: ['place', 'reference', 'edit'],
    referenced: false,
    noteHeightMode: 'fixed',
  });
  assert.equal(byId(commands, 'open')?.label, '在阅读器打开');
  assert.equal(byId(commands, 'open')?.disabledReason, undefined);
  assert.equal(byId(commands, 'reference')?.disabledReason, undefined);
  assert.equal(byId(commands, 'reference')?.capability, 'reference');
  assert.equal(byId(commands, 'auto-height')?.label, '自动高度');

  const primary = primaryNodeCommands(commands);
  assert.deepEqual(
    primary.map((c) => c.id),
    ['open', 'reference', 'auto-height'],
  );
  for (const command of primary) assert.equal(command.disabledReason, undefined);

  // Core 投影的删除带真实 reason（不是 GAP）
  assert.equal(
    byId(commands, 'delete')?.disabledReason,
    '这是 Core 投影，删除后会重新投影出现；请在 Core 侧移除',
  );
  // 未绑定时删除是真的可用
  const unbound = buildLcosNodeCommands(base);
  assert.equal(byId(unbound, 'delete')?.disabledReason, undefined);
});

test('R2 命令模型：note 近场顺序受 引用能力 影响（不支持引用时给真实 reason）', () => {
  const commands = buildLcosNodeCommands({
    nodeType: 'note',
    entityType: 'artifact',
    entityId: 'a1',
    capabilities: ['place', 'edit'],
    referenced: false,
  });
  assert.equal(byId(commands, 'reference')?.disabledReason, '该 Core 物种不支持引用');
  // 空 capabilities（未取到 descriptor）不算"不支持"
  const noDescriptor = buildLcosNodeCommands({
    nodeType: 'note',
    entityType: 'artifact',
    entityId: 'a1',
    capabilities: [],
    referenced: true,
  });
  assert.equal(byId(noDescriptor, 'reference')?.disabledReason, undefined);
  assert.equal(byId(noDescriptor, 'reference')?.label, '取消引用');
});

test('R2 命令模型：image 只有旧工具条真有的控件（无文本/笔记互转、无自动高度）', () => {
  const commands = buildLcosNodeCommands({ nodeType: 'image', capabilities: [], referenced: false });
  const ids = idsOf(commands);
  assert.equal(ids.includes('convert-text'), false);
  assert.equal(ids.includes('auto-height'), false);
  assert.equal(ids.includes('convert-note'), false);
  for (const id of ['size', 'accent', 'open-large', 'move-space', 'fit']) {
    assert.ok(ids.includes(id), `image 缺少 ${id}`);
  }
  assert.equal(byId(commands, 'open'), undefined, 'image 无 Core 就无法出现 open');
  assert.equal(byId(commands, 'delete')?.disabledReason, undefined);
});

test('R2 命令模型：canvasRef 无 targetCanvasId 不出现 open，也不出现尺寸/强调色/移动', () => {
  const commands = buildLcosNodeCommands({ nodeType: 'canvasRef', capabilities: [], referenced: false });
  const ids = idsOf(commands);
  assert.equal(byId(commands, 'open'), undefined);
  assert.equal(ids.includes('accent'), false);
  assert.equal(ids.includes('size'), false);
  assert.equal(ids.includes('move-space'), false);
  assert.ok(ids.includes('fit'));
  assert.ok(ids.includes('delete'));

  const bound = buildLcosNodeCommands({
    nodeType: 'canvasRef',
    targetCanvasId: 'c-9',
    capabilities: [],
    referenced: false,
  });
  assert.equal(byId(bound, 'open')?.label, '查看入口目标');
  assert.equal(byId(bound, 'open')?.disabledReason, undefined);
});

test('R2 命令模型：未绑定 Core 的 note 不出现 open / reference（不适用即不显示）', () => {
  const commands = buildLcosNodeCommands(base);
  assert.equal(byId(commands, 'open'), undefined);
  assert.equal(byId(commands, 'reference'), undefined);
  // 会话/物件的打开语义仍按 Core 绑定区分
  assert.equal(
    byId(buildLcosNodeCommands({ ...base, entityType: 'conversation', entityId: 'c1' }), 'open')?.label,
    '打开工作台',
  );
});

test('R2 命令模型：覆盖关系表之外的类型返回空数组（继续挂旧壳）', () => {
  for (const nodeType of ['frame', 'sketch', 'question', 'text', 'pdf', 'office', undefined]) {
    const commands = buildLcosNodeCommands({ nodeType, capabilities: [], referenced: false });
    assert.deepEqual(commands, [], `${String(nodeType)} 不应生成 Arc 命令`);
  }
});

test('R2 命令模型：通用不变量——带 disabledReason 的命令，原因必须是非空字符串', () => {
  const inputs: readonly LcosNodeCommandInput[] = [
    base,
    { ...base, nodeType: 'image' },
    { ...base, nodeType: 'video' },
    { ...base, nodeType: 'audio' },
    { ...base, nodeType: 'nodeRef' },
    { ...base, nodeType: 'canvasRef' },
    { ...base, entityType: 'artifact', entityId: 'a1', capabilities: ['place', 'edit'] },
    { ...base, entityType: 'conversation', entityId: 'c1', capabilities: ['place', 'reference'] },
  ];
  for (const input of inputs) {
    for (const command of buildLcosNodeCommands(input)) {
      if (command.disabledReason === undefined) continue;
      assert.equal(typeof command.disabledReason, 'string');
      assert.ok(command.disabledReason.length > 0, `${command.id} 给了空 reason`);
      // 近场只放可用命令
      assert.equal(
        primaryNodeCommands(buildLcosNodeCommands(input)).some((c) => c.id === command.id),
        false,
        `${command.id} 不可用却上了近场`,
      );
    }
  }
});
