// Sprint 2B（T4）：Professional Window 布局纯模型（React-free）。
//
// 唯一拓扑 owner 是 ProfessionalWindowStage（T4 §2.1）：safeRect/occupiedRects
// 只有 Stage 一个 producer；body registry 只把 bodyKey 解析到唯一 factory。
// 本文件只做纯几何/身份推导，不持有任何业务状态、不碰 Canvas camera/selection。

/** 专业 body 类型（T4 §3 五类 + Assembly/Conversation Work View 容器 + Doctor 诊断）。 */
export type ProfessionalBodyKeyV1 =
  | 'assembly'
  | 'conversation-work'
  | 'receiver'
  | 'capture-inbox'
  | 'connector-source'
  | 'waiting-input'
  | 'recovery'
  | 'doctor'

export interface ProfessionalRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一个 Professional region 的稳定身份：regionId 由 bodyKey+target 推导，不猜。 */
export interface ProfessionalRegionRefV1 {
  readonly regionId: string;
  readonly bodyKey: ProfessionalBodyKeyV1;
  /** canonical target identity（ConnectedConversation.id / AssemblyTargetRef 等），generation guard 的 key。 */
  readonly targetKey: string;
}

/** Stage 一次性冻结的 window environment（T4 §2.1：唯一 producer = Stage）。 */
export interface ProfessionalWindowEnvironmentV1 {
  readonly safeRect: ProfessionalRectV1;
  readonly occupiedRects: readonly ProfessionalRectV1[];
  readonly activeRegionId: string | undefined;
}

/** 唯一 region identity 规则：Conversation Work View 按 ConnectedConversation.id 定位。 */
export function professionalRegionRefV1(
  bodyKey: ProfessionalBodyKeyV1,
  targetKey: string,
): ProfessionalRegionRefV1 {
  const regionId =
    bodyKey === 'conversation-work'
      ? `lcos:conversation:${targetKey}`
      : `lcos:${bodyKey}:${targetKey}`;
  return { regionId, bodyKey, targetKey };
}

/** 两矩形是否重叠（边界相接不算重叠）。 */
export function rectsOverlapV1(a: ProfessionalRectV1, b: ProfessionalRectV1): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * 在 env 中放置 region：preferred 与所有 occupied 都不重叠则直接返回；
 * 否则尝试向右错位一格；仍冲突返回 undefined（由 Stage 决定隐藏/堆叠，不覆盖稳定锚点）。
 */
export function placeProfessionalRegionV1(
  env: ProfessionalWindowEnvironmentV1,
  preferred: ProfessionalRectV1,
  stepX = 24,
  stepY = 24,
): ProfessionalRectV1 | undefined {
  const candidates: readonly ProfessionalRectV1[] = [
    preferred,
    { ...preferred, x: preferred.x + stepX, y: preferred.y + stepY },
  ];
  for (const candidate of candidates) {
    const overlapsAny = env.occupiedRects.some((occupied) => rectsOverlapV1(candidate, occupied));
    if (!overlapsAny) return candidate;
  }
  return undefined;
}
