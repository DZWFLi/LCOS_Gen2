// T3 Action Arc 的**节点命令模型**（React-free，R2 返工）。
//
// 与 `actionArcModel.ts`（continuation actions）同一纪律：
//   - 动作是**具名 id**，label 只用于显示，绝不按文案推断业务动作；
//   - 只有真实存在 owner 的动作才可执行；不可执行的必须给出真实 reason；
//   - 不适用（该类型旧工具条根本没有这个控件）的动作**不出现**，不做"灰按钮堆"。
//
// 覆盖关系表驱动（2026-09-14 返工）：
//   LCOS 模式下停挂旧 `NodeFloatingToolbar` 的节点类型只有
//   `note` / `image` / `video` / `audio` / `canvasRef` / `nodeRef`（逐类读码核对）。
//   `ARC_SURFACES` 逐类型记录这些类型在旧工具条上**真实拥有**哪些控件。
//   —— 旧壳退役 = 覆盖关系表驱动：
//      * 表内类型由 Arc 全权代理，旧工具条停挂；
//      * 表外类型（text / frame / sketch / pdf / office / web…）旧控件尚未被 Arc 覆盖，
//        `buildLcosNodeCommands` 返回空数组，**让该类型继续挂旧壳**；
//      * 未覆盖的旧控件不在这里假装 GAP（"尚未接线"按钮既误导用户，又掩盖真实覆盖缺口）。
//
// 形状遵循 T3-A02：节点近场、3 个常规动作 + 最多 4 个（第 4 个是"更多"入口）。
//
// 能力来源：`rendererRegistry.descriptorFor(entity).capabilities`（Core family → capability），
// 不再自造第二套 capability 词表。

import type { NodeCapability } from '../presentation/rendererRegistry.js';

/** 节点命令 id（唯一具名动作；dispatch 一律按 id）。 */
export type LcosNodeCommandId =
  // 能力驱动（来自 descriptorFor / 原生节点语义）
  | 'open'
  | 'compose'
  | 'reference'
  // 画布机械（复用 Huabu 既有命令，不重写 store）
  | 'convert-text'
  | 'convert-note'
  | 'auto-height'
  | 'size'
  | 'accent'
  | 'open-large'
  | 'move-space'
  | 'fit'
  | 'delete';

export type LcosNodeCommandGroup = '进入' | '关系' | '编辑' | '外观' | '空间';

export interface LcosNodeCommand {
  readonly id: LcosNodeCommandId;
  readonly label: string;
  readonly group: LcosNodeCommandGroup;
  /** 该命令要求 Core capability（缺省 = 画布机械命令，任何节点可用）。 */
  readonly capability?: NodeCapability;
  /** 有值即不可用，值就是真实原因（显示在命令上）。 */
  readonly disabledReason?: string;
}

export interface LcosNodeCommandInput {
  /** Huabu 原生节点类型（note/text/image/frame/sketch/question/canvasRef…）。 */
  readonly nodeType: string | undefined;
  /** Core 绑定（未绑定 = 该节点没有 Core 身份）。 */
  readonly entityType?: string;
  readonly entityId?: string;
  /** 原生 Portal 目标现场。 */
  readonly targetCanvasId?: string;
  /** Core family → capability（来自 descriptorFor）。 */
  readonly capabilities: readonly NodeCapability[];
  /** 是否已在 Composer 草稿引用里（真实 presentation state）。 */
  readonly referenced: boolean;
  /** note 节点当前高度模式（'auto' 时给出"固定高度"动作）。 */
  readonly noteHeightMode?: 'auto' | 'fixed';
}

/** A complete Core identity marks a projected node as non-deletable locally. */
export function isLcosNodeDeleteAllowed(
  input: Pick<LcosNodeCommandInput, 'entityType' | 'entityId'> | undefined,
): boolean {
  return input?.entityType === undefined || input.entityId === undefined;
}

/**
 * 一个节点类型在旧 `NodeFloatingToolbar` 上**真实拥有**的控件。
 * 这是覆盖关系表（不是能力推断）：只有旧壳真有、且 Arc 已接线到真实命令的控件才为 true。
 */
interface ArcSurface {
  /** 文本 / 笔记互转。 */
  readonly typeToggle: boolean;
  readonly accent: boolean;
  readonly size: boolean;
  readonly openLarge: boolean;
  readonly move: boolean;
  readonly autoHeight: boolean;
}

/**
 * 覆盖关系表：LCOS 模式下停挂旧工具条的 6 个类型 → 旧工具条真实控件。
 * 表外类型一律返回空数组（继续挂旧壳），见文件头。
 */
const ARC_SURFACES: Readonly<Record<string, ArcSurface>> = {
  note: { typeToggle: true, accent: true, size: true, openLarge: true, move: true, autoHeight: true },
  image: { typeToggle: false, accent: true, size: true, openLarge: true, move: true, autoHeight: false },
  video: { typeToggle: false, accent: true, size: true, openLarge: true, move: true, autoHeight: false },
  audio: { typeToggle: false, accent: true, size: true, openLarge: false, move: true, autoHeight: false },
  canvasRef: { typeToggle: false, accent: false, size: false, openLarge: false, move: false, autoHeight: false },
  nodeRef: { typeToggle: false, accent: true, size: true, openLarge: false, move: false, autoHeight: false },
  // Core-bound text keeps native editing out of the LCOS shell; Arc owns the
  // shared open/compose/reference and canvas mechanics for that projection.
  text: { typeToggle: false, accent: true, size: true, openLarge: false, move: true, autoHeight: false },
};

/**
 * 打开去向：**只有真实存在打开目标时才出现**（否则整条不出现，而不是给个灰按钮）。
 * 只认已接入的真实窗口 body（入口预览 / 会话窗口 / 阅读器）。
 */
function openCommand(input: LcosNodeCommandInput): LcosNodeCommand | undefined {
  if (input.nodeType === 'canvasRef' && input.targetCanvasId) {
    return { id: 'open', label: '查看入口目标', group: '进入' };
  }
  if (input.entityType === 'conversation') {
    return { id: 'open', label: '打开会话窗口', group: '进入' };
  }
  if (input.entityType === 'artifact') {
    return { id: 'open', label: '在阅读器打开', group: '进入' };
  }
  return undefined;
}

/**
 * 引用：**只有已绑定 Core（entityType + entityId 齐备）时才出现**。
 * capability 闸门只在传入 capabilities 非空且明确不含 'reference' 时给真实原因
 * （空数组 = 未取到 descriptor，不假装 Core 不支持）。
 */
function referenceCommand(input: LcosNodeCommandInput): LcosNodeCommand {
  const unsupported = input.capabilities.length > 0 && !input.capabilities.includes('reference');
  return {
    id: 'reference',
    label: input.referenced ? '取消引用' : '加入引用',
    group: '关系',
    capability: 'reference',
    ...(unsupported ? { disabledReason: '该 Core 物种不支持引用' } : {}),
  };
}

/**
 * 完整命令清单（Arc 的"更多"面板按 group 展示）。
 * 顺序 = 进入 → 关系 → 编辑 → 外观 → 空间；表外类型返回空数组。
 */
export function buildLcosNodeCommands(input: LcosNodeCommandInput): readonly LcosNodeCommand[] {
  const bound = !isLcosNodeDeleteAllowed(input);
  const surface = input.nodeType === 'text' && !bound
    ? undefined
    : input.nodeType === undefined ? undefined : ARC_SURFACES[input.nodeType];
  // 纵深防御：Arc 本身也按类型闸门，这里再挡一层 —— 未覆盖类型继续挂旧壳。
  if (!surface) return [];

  const commands: LcosNodeCommand[] = [];

  // 进入
  const open = openCommand(input);
  if (open) commands.push(open);
  if (bound) {
    // Composer 由当前选中对象的近场 Arc 显式呼出；Assembly 保持独立项目级入口。
    commands.push({ id: 'compose', label: '围绕此对象工作', group: '进入' });
  }

  // 关系
  if (bound) commands.push(referenceCommand(input));

  // 编辑
  if (input.nodeType === 'note' && surface.autoHeight) {
    commands.push({
      id: 'auto-height',
      label: input.noteHeightMode === 'auto' ? '固定高度' : '自动高度',
      group: '编辑',
    });
  }
  if (input.nodeType === 'note' && surface.typeToggle) {
    commands.push({ id: 'convert-text', label: '转为文本', group: '编辑' });
  }
  // 文本原生节点目前不在 Arc 服务范围（表外类型直接 fail-close），此分支保留以保持模型完整。
  if (input.nodeType === 'text' && surface.typeToggle) {
    commands.push({ id: 'convert-note', label: '转为笔记', group: '编辑' });
  }
  // 删除：Core 投影删掉后 reconcile 会重新投影，必须说清而不是假装删掉了。
  commands.push({
    id: 'delete',
    label: '删除节点',
    group: '编辑',
    ...(bound ? { disabledReason: '这是 Core 投影，删除后会重新投影出现；请在 Core 侧移除' } : {}),
  });

  // 外观（画布呈现状态：尺寸几何 / node.data.style；不是域写操作，故不走 Core capability 闸门）
  if (surface.size) commands.push({ id: 'size', label: '尺寸 W/H', group: '外观' });
  if (surface.accent) commands.push({ id: 'accent', label: '强调色', group: '外观' });

  // 空间
  if (surface.openLarge) commands.push({ id: 'open-large', label: '打开大视图', group: '空间' });
  if (surface.move) commands.push({ id: 'move-space', label: '移动到其它现场', group: '空间' });
  // fit = 相机呈现命令，owner = LCOS shell `requestCamera('fit')`，任何表内类型都给。
  commands.push({ id: 'fit', label: '适合画面', group: '空间' });

  return commands;
}

/**
 * 近场 Arc 上的主命令：T3-A02 的「3 normal / 最多 4」（第 4 个是"更多"入口）。
 * 只有**能直接派发**且当前可用的命令才上近场排；其余（含需要面板内联控件的 尺寸/强调色、
 * 以及所有不可用命令）留在"更多"面板里，带真实原因显示。
 */
const PRIMARY_ELIGIBLE: ReadonlySet<LcosNodeCommandId> = new Set([
  'open',
  'compose',
  'reference',
  'convert-note',
  'auto-height',
  'open-large',
  'move-space',
  'fit',
  'delete',
]);

export function primaryNodeCommands(
  commands: readonly LcosNodeCommand[],
  max = 3,
): readonly LcosNodeCommand[] {
  return commands
    .filter((command) => command.disabledReason === undefined && PRIMARY_ELIGIBLE.has(command.id))
    .slice(0, max);
}
