// LCOS 节点命令表（T3 Action Arc 的纯逻辑部分，R2）。
//
// 只做两件事：把"当前节点真实是什么"翻译成一份命令清单，并给不可用命令写明原因。
// 不碰任何 store/组件：这样命令集可以被单测钉住，也不会变成第二套命令实现。
//
// 诚实规则：
//   - 有真实 handler 的才出现在可执行组；
//   - 没有接线的命令**照样列出**，但标 `尚未接线（GAP）` 并禁用 —— 不隐藏能力缺口，
//     也不用假按钮骗点击（旧工具条在这些命令上仍然可用，本轮不退役它）。

export type LcosNodeCommandGroup = '进入' | '关系' | '编辑' | '视图' | '未接线';

export interface LcosNodeCommand {
  readonly id: string;
  readonly label: string;
  readonly group: LcosNodeCommandGroup;
  /** 有值即禁用，值就是真实原因（Figma SurfaceFeedback 的 disabled 语义）。 */
  readonly disabledReason?: string;
}

export interface LcosNodeCommandInput {
  /** Huabu 原生节点类型（note/text/image/frame/canvasRef…）。 */
  readonly nodeType: string | undefined;
  /** Core 绑定（未绑定 = 没有 Core 身份）。 */
  readonly entityType?: string;
  readonly entityId?: string;
  /** 原生 Portal 节点的目标现场。 */
  readonly targetCanvasId?: string;
  /** 该节点当前是否已在 Composer 草稿引用里（真实 presentation state）。 */
  readonly referenced: boolean;
}

const GAP = '尚未接线（GAP）';

/** 解析该节点的"打开"去向：只认已接入的窗口 body。 */
export function resolveOpenCommand(input: LcosNodeCommandInput): LcosNodeCommand {
  if (input.nodeType === 'canvasRef') {
    return {
      id: 'open',
      label: '查看入口目标',
      group: '进入',
      ...(input.targetCanvasId
        ? {}
        : { disabledReason: '该入口没有绑定目标（未绑定现场）' }),
    };
  }
  if (input.entityType === 'conversation') {
    return { id: 'open', label: '打开会话工作台', group: '进入' };
  }
  if (input.entityType === 'artifact') {
    return { id: 'open', label: '在阅读器打开', group: '进入' };
  }
  return {
    id: 'open',
    label: '打开',
    group: '进入',
    disabledReason: input.entityType === undefined ? '该节点未绑定 Core 实体' : '该物种没有已接入的打开目标',
  };
}

/**
 * 该节点的完整命令清单。
 * 顺序 = 进入 → 关系 → 编辑 → 视图 → 未接线（缺口集中在最后，便于一眼看全）。
 */
export function buildLcosNodeCommands(input: LcosNodeCommandInput): readonly LcosNodeCommand[] {
  const commands: LcosNodeCommand[] = [resolveOpenCommand(input)];

  commands.push({
    id: 'reference',
    label: input.referenced ? '取消引用（Composer 草稿）' : '加入引用（Composer 草稿）',
    group: '关系',
    ...(input.entityType === undefined || input.entityId === undefined
      ? { disabledReason: '该节点未绑定 Core 实体，无法建立引用' }
      : {}),
  });

  const isTextFamily = input.nodeType === 'note' || input.nodeType === 'text';
  commands.push({
    id: input.nodeType === 'text' ? 'convert-note' : 'convert-text',
    label: input.nodeType === 'text' ? '转为笔记' : '转为文本',
    group: '编辑',
    ...(isTextFamily ? {} : { disabledReason: '只有 文本/笔记 之间可转换' }),
  });

  commands.push({
    id: 'delete',
    label: '删除节点',
    group: '编辑',
    // 已绑定的节点是 Core 投影：删掉后下一次 reconcile 会重新投影出来（不是真删除）。
    // 因此这里禁用并说明原因，而不是让用户以为删掉了。
    ...(input.entityType === undefined
      ? {}
      : { disabledReason: '这是 Core 投影，删除后 reconcile 会重新出现；请在 Core 侧移除' }),
  });

  commands.push({ id: 'fit', label: '适合画面', group: '视图' });

  // 缺口集中列出（旧工具条仍覆盖这些；本轮不退役它，所以这里只做标注）。
  commands.push(
    { id: 'accent', label: '强调色', group: '未接线', disabledReason: GAP },
    { id: 'size', label: '尺寸档', group: '未接线', disabledReason: GAP },
    { id: 'text-format', label: '文本格式', group: '未接线', disabledReason: GAP },
    { id: 'run', label: 'AI 运行 / 取消', group: '未接线', disabledReason: GAP },
  );

  return commands;
}
