// 新投影落位（R2）："新东西自己找地方，老东西绝不动"。
//
// Provenance（donor，A 级纯逻辑直接复用）：
//   owner: DZWFLi
//   repo:  LCOS-local-creativeOS（旧库，只读 donor）
//   path:  apps/web/src/features/canvas/canvasGeometry.ts
//          ::paddedRectsOverlap / placeNewNodesIncrementally（原样搬运 + 类型改名）
//   本地读取 commit: f084158（E:\Codex 项目… 与 Desktop\GitHub原件 副本同源）
//   审计引用的 GitHub ref: 3e99769（SOURCE_ADOPTION_LEDGER T1-A03）
//   license: 该库无 LICENSE 文件、package.json 无 license 字段（自有库，仅内部复用）
//
// 替换前：projectArtifacts / projectConversations 用 `index * 40` 机械级联，
//   3 个 280×220 节点互相重叠 40px，视口 fit 后被放大到 348% 不可读（R0 已定位）。
// 替换后：新节点在用户原点周围的格点上找"第一个不与既有节点重叠"的位置；
//   既有节点只作为障碍物读取，永不返回调整位置（仍是唯一 spatial owner = Huabu）。

/** 障碍物/候选框（世界坐标）。 */
export interface PlacementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 待落位项的世界尺寸。 */
export interface PlacementItem {
  readonly width: number;
  readonly height: number;
}

/** 落位结果（世界坐标）。 */
export interface PlacementPoint {
  readonly x: number;
  readonly y: number;
}

/** 默认留白：与 GEN1 一致（18）。 */
export const PLACEMENT_GAP = 18;

/** 搜索起点偏移（同心环的环 0）。 */
const ORIGIN_OFFSET: { x: number; y: number } = { x: 0, y: 0 };

function paddedRectsOverlap(a: PlacementBounds, b: PlacementBounds, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * 为新一批投影找落位：既有节点只读作障碍，新项保持输入顺序，
 * 从 origin 起按同心环搜索最近的空位。
 *
 * @param existing  既有节点包围盒（世界坐标）
 * @param newcomers 待落位项（世界尺寸），顺序即输入顺序
 * @param origin    搜索原点（例如既有内容的右缘外侧）
 * @param gap       间距（同时用于重叠判定与格点步长）
 */
export function placeNewNodesIncrementally(
  existing: readonly PlacementBounds[],
  newcomers: readonly PlacementItem[],
  origin: PlacementPoint,
  gap = PLACEMENT_GAP,
): PlacementPoint[] {
  if (newcomers.length === 0) return [];
  const maxWidth = Math.max(...newcomers.map((item) => item.width), 1);
  const maxHeight = Math.max(...newcomers.map((item) => item.height), 1);
  const stepX = maxWidth + gap;
  const stepY = maxHeight + gap;
  const occupied: PlacementBounds[] = [...existing];
  const result: PlacementPoint[] = [];

  const offsets: { x: number; y: number }[] = [ORIGIN_OFFSET];
  for (let radius = 1; radius <= 24; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) offsets.push({ x, y: -radius });
    for (let y = -radius + 1; y <= radius; y += 1) offsets.push({ x: radius, y });
    for (let x = radius - 1; x >= -radius; x -= 1) offsets.push({ x, y: radius });
    for (let y = radius - 1; y >= -radius + 1; y -= 1) offsets.push({ x: -radius, y });
  }

  newcomers.forEach((item, index) => {
    const preferred = offsets[index] ?? ORIGIN_OFFSET;
    const search: { x: number; y: number }[] = [
      preferred,
      ...offsets.filter((offset) => offset !== preferred),
    ];
    let chosen: PlacementPoint = {
      x: origin.x + preferred.x * stepX,
      y: origin.y + preferred.y * stepY,
    };
    for (const offset of search) {
      const candidate: PlacementBounds = {
        x: origin.x + offset.x * stepX,
        y: origin.y + offset.y * stepY,
        width: item.width,
        height: item.height,
      };
      if (occupied.every((other) => !paddedRectsOverlap(candidate, other, gap))) {
        chosen = { x: candidate.x, y: candidate.y };
        break;
      }
    }
    result.push(chosen);
    occupied.push({ ...chosen, width: item.width, height: item.height });
  });

  return result;
}

/**
 * 新一批投影的搜索原点：既有内容的右缘外侧；空画布回到世界原点。
 * 只读既有 bbox（`GET_SPACE_OUTLINE`），不重排、不移动任何既有节点。
 */
export function placementOriginFor(
  bounds: { x: number; y: number; width: number; height: number } | null,
  gap = PLACEMENT_GAP,
): PlacementPoint {
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.x + bounds.width + gap, y: bounds.y };
}
