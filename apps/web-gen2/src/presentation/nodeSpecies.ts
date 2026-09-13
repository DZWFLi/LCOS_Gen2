// nodeSpecies — Core entity → 节点物种（React-free 纯逻辑）。
// 物种 = 语义呈现策略 key，来自 Core metadata（entityType/artifactKind/mimeType/sourceKind/
// sourceRunId/managed），绝不按 title/id 前缀猜。Figma variant 不反向创造 domain enum。

export type LcosNodeSpecies =
  | 'source' // 原内容/来源材料（内容优先、来源脊柱）
  | 'working' // 当前加工中的状态（活跃边/轻状态）
  | 'draft' // AI 派生产出（Draft/Pending/Review，绝不冒充 Current）
  | 'context-reference' // 引用/集合语义、来源锚点
  | 'run' // 过程与执行状态（queued/running/waiting_input/review/failed）
  | 'decision' // 决策/版本标记
  | 'glyth' // Conversation/Agent 活身份（活动/注意力/LOD）
  | 'collection' // 容器/入口（事件/时间两类图标）
  | 'workflow-collection' // 任务牌组入口
  | 'portal' // 现场入口/投影锚点
  | 'prompt-frame' // 提示/question 框架（状态、agent binding、replay）
  | 'unknown'; // 未分类 → 显示诊断原因

export interface NodeSpeciesSource {
  readonly entityType?: string;
  readonly artifactKind?: string;
  readonly mimeType?: string;
  readonly sourceKind?: string;
  readonly sourceRunId?: string;
  readonly managed?: boolean;
}

export const NODE_SPECIES_LABEL: Readonly<Record<LcosNodeSpecies, string>> = {
  source: '材料',
  working: '加工中',
  draft: '草稿',
  'context-reference': '引用',
  run: '运行',
  decision: '决策',
  glyth: '会话',
  collection: '集合',
  'workflow-collection': '工作流',
  portal: '入口',
  'prompt-frame': '提示',
  unknown: '未分类',
};

/**
 * 解析节点物种：entityType 优先，artifact 再按 kind/mime/source 细化。
 * 未知一律 unknown，绝不静默降级成其它物种（禁 silent fallback 到 collection）。
 */
export function resolveNodeSpecies(source: NodeSpeciesSource): LcosNodeSpecies {
  const kind = source.artifactKind;
  const mime = (source.mimeType ?? '').toLowerCase();
  const sourceKind = source.sourceKind;

  switch (source.entityType) {
    case 'conversation':
      return 'glyth';
    case 'run':
      return 'run';
    case 'skill':
      return 'source';
    case 'artifact':
    default:
      break;
  }

  if (kind === 'collection' || kind === 'context') return 'collection';
  if (kind === 'workflow') return 'workflow-collection';
  if (kind === 'portal') return 'portal';
  if (kind === 'decision' || kind === 'checkpoint') return 'decision';
  if (kind === 'question' || kind === 'prompt') return 'prompt-frame';
  if (kind === 'reference' || sourceKind === 'reference' || sourceKind === 'context') {
    return 'context-reference';
  }

  // AI 派生产出（Draft）：有来源 Run 且为 managed 输出
  if (source.sourceRunId !== undefined && source.managed === true) return 'draft';

  // 其余按内容族归为 source（图片/文档/文本/网页/音视频/文件）
  if (
    kind !== undefined ||
    mime !== '' ||
    sourceKind === 'url' ||
    sourceKind === 'web' ||
    sourceKind === 'file'
  ) {
    return 'source';
  }

  return 'unknown';
}

/**
 * 从绑定实体 ref 直接映射（缺 metadata 时只凭 entityType）。
 * 供 seam resolver 使用：binding 只给 entityType/entityId。
 */
export function resolveNodeSpeciesFromEntityType(entityType: string | undefined): LcosNodeSpecies {
  switch (entityType) {
    case 'conversation':
      return 'glyth';
    case 'run':
      return 'run';
    case 'skill':
      return 'source';
    case 'artifact':
      return 'source';
    default:
      return 'unknown';
  }
}