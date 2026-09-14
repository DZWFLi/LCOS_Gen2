// 投影节点的呈现描述（R2）：把 Core 的真实元数据带到节点 body，而不是让 body 显示静态占位文案。
//
// 这里只描述"呈现事实"（kind / availability / managed / revision），不复制任何真值：
//   - 真值仍在 Local Core（Artifact/Revision）；
//   - 空间身份仍在 Huabu（ProjectionBinding）；
//   - 本描述是 reconcile 时从 Core 快照派生的一次性投影（可随时重建，不落库）。
//
// 消费者：Huabu 侧 `useLcosReferenceStore` 的 nodeEntityRefs.descriptor（presentation state），
// 供单一 NodePresentation Junction 决定物种与次级行。

import { resolveNodeSpecies, type LcosNodeSpecies } from './nodeSpecies.js';

/** Core Artifact 的呈现事实（字段名与 domain Artifact 对齐）。 */
export interface ProjectedEntityFacts {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  /** Core `ArtifactKind`（text/markdown/image/pdf/presentation/…）。 */
  readonly artifactKind?: string;
  readonly managed?: boolean;
  /** Core `ArtifactAvailability`（current / missing / stale …）。 */
  readonly availability?: string;
  readonly currentRevisionId?: string;
  readonly mimeType?: string;
  readonly sourceKind?: string;
  /**
   * 当前 revision 对应的 Core FileRecord id —— 真实字节出口（`GET /projects/:id/file-records/:fid/content`）的键。
   * 呈现层据此把真实内容搬进画布资产区（图片缩略图等）；它只是键，不复制真值。
   */
  readonly fileRecordId?: string;
  /**
   * 真实正文预览（R2 返工，用户裁决 B：Core 投影节点 = 标题 + 真实次级行 + preview/status）。
   * 来自 Core `GET /projects/:id/file-records/:fid/content` 的前若干字符；读不到就不带此字段
   * （body 退回形态说明，绝不编造正文）。
   */
  readonly preview?: string;
  /** 承接会话（conversation/Glyth）的真实运行事实。 */
  readonly provider?: string;
  readonly active?: boolean;
  readonly waiting?: boolean;
}

/** 前端树上挂载的呈现描述。 */
export interface ProjectedNodeDescriptor extends ProjectedEntityFacts {
  /** 真实次级行（由真实事实拼出；没有事实就返回空串，不编造）。 */
  readonly secondaryLine: string;
  /** 解析后的物种（与 junction 用同一函数，避免两处口径不一致）。 */
  readonly species: LcosNodeSpecies;
}

/** Core 枚举 → 中文短标签；未收录的枚举原样返回（不猜）。 */
const KIND_LABEL: Readonly<Record<string, string>> = {
  markdown: '文本',
  text: '文本',
  image: '图片',
  pdf: 'PDF',
  presentation: '演示',
  file: '文件',
  conversation: '会话',
  skill: '技能',
  run: '运行',
};

/** Core `ArtifactAvailability`（'available' | 'missing' | 'stale'）→ 中文短标签。 */
const AVAILABILITY_LABEL: Readonly<Record<string, string>> = {
  available: '可用',
  current: '现行',
  missing: '源缺失',
  stale: '待确认',
  external: '外部引用',
};

/**
 * 真实次级行：只写有事实的部分。
 * 例：`文本 · 受管 · 现行` / `图片 · 外部引用` / `（无 Core 元数据）`。
 */
export function buildNodeSecondaryLine(facts: ProjectedEntityFacts): string {
  const parts: string[] = [];

  // 会话/Glyth：次级行是"身份 + 运行态"，与 artifact 的 kind/revision 不是一套事实。
  if (facts.entityType === 'conversation') {
    if (facts.provider !== undefined && facts.provider !== '') parts.push(facts.provider);
    if (facts.waiting === true) parts.push('等待输入');
    else if (facts.active === true) parts.push('运行中');
    else if (facts.active === false) parts.push('空闲');
    return parts.length === 0 ? '会话 · 身份未确认' : parts.join(' · ');
  }

  const kind = facts.artifactKind;
  if (kind !== undefined && kind !== '') parts.push(KIND_LABEL[kind] ?? kind);
  if (facts.managed === true) parts.push('受管');
  const availability = facts.availability;
  if (availability !== undefined && availability !== '' && availability !== 'current') {
    parts.push(AVAILABILITY_LABEL[availability] ?? availability);
  }
  if (facts.currentRevisionId !== undefined && facts.currentRevisionId !== '') {
    parts.push(`rev ${facts.currentRevisionId.slice(0, 8)}`);
  }
  if (parts.length === 0) parts.push('（无 Core 元数据）');
  return parts.join(' · ');
}

/**
 * 从真实事实解析物种（实体类型 → Core kind → Huabu 原生节点类型，逐级降级）。
 *
 * huabuNodeType 兜底**故意收得很窄**：只认"本身没有可编辑/可视化内容、必须由 LCOS 呈现"
 * 的原生类型（当前只有 `canvasRef`）。`note`/`text`/`image`/`frame` 等一律不兜底 ——
 * 未绑定 Core 的用户节点必须留在 native body（编辑能力与画布自带渲染不能被我方 body 顶掉）。
 *
 * 说明：working / draft 需要 Run 关联事实（当前 reconcile 不产出），仍不可达 —— 见 ledger 缺口。
 */
export function resolveNodeSpeciesFromFacts(facts: {
  readonly entityType?: string;
  readonly artifactKind?: string;
  readonly managed?: boolean;
  readonly mimeType?: string;
  readonly sourceKind?: string;
  /** Huabu 原生节点类型（机械投影的结果）。 */
  readonly huabuNodeType?: string;
}): LcosNodeSpecies {
  const byEntity = resolveNodeSpecies({
    entityType: facts.entityType,
    artifactKind: facts.artifactKind,
    mimeType: facts.mimeType,
    sourceKind: facts.sourceKind,
    managed: facts.managed,
  });
  if (byEntity !== 'unknown') return byEntity;

  // 有 Core 绑定但缺 Kind 事实（图快照读不到时）→ artifact 仍按机械投影视为 source，
  // 不退化成"未绑定"（否则一次 Core 抖动就会让已投影节点静默变回 native body）。
  if (facts.entityType === 'artifact') return 'source';

  // 无 Core 绑定时只认"纯入口壳"类型；其余一律 unknown（→ native body，不静默降级）。
  if (facts.huabuNodeType === 'canvasRef') return 'portal';
  return 'unknown';
}

/** 组装描述（species 与 secondaryLine 用同一份事实，避免两处口径漂移）。 */
export function describeProjectedEntity(facts: ProjectedEntityFacts): ProjectedNodeDescriptor {
  return {
    ...facts,
    secondaryLine: buildNodeSecondaryLine(facts),
    species: resolveNodeSpeciesFromFacts(facts),
  };
}

/**
 * 从 Core 文件正文派生**真实预览**（用户裁决 B 的 `preview` 位）。
 *
 * 只做忠实截断与轻量去噪，不改写内容语义：
 *   - 去掉 front-matter / 代码块 / 列表符号 / 行内强调标记；
 *   - 去掉首个 H1（通常与 artifact 标题重复，标题已经单独渲染）；
 *   - 折叠空白后截断到 maxChars，截断处加省略号。
 * 空正文返回空串 —— 调用方据此**不写** preview 字段（绝不编造正文）。
 */
export function buildContentPreview(raw: string, maxChars = 160): string {
  const withoutFrontMatter = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const cleaned = withoutFrontMatter
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*#\s+.*$/m, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return '';
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars).trimEnd()}…`;
}
