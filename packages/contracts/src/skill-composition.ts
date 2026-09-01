/**
 * SkillCompositionV1 — Root/Subskill composition 契约（S8，吸收前端 composition contract）。
 *
 * 裁决要点：
 *   - 单一 canonical truth 只归 `packages/contracts`；Core 负责验证（validateSkillComposition）。
 *   - Package 文件仍落 `<skillDir>/references/lcos-skill-composition.json`，但 schema 由本契约定义。
 *   - requiredCapabilities / optionalCapabilities 由 Skill 作者声明，S8 起从 composition 读取真实值。
 *
 * 依赖/子技能安装语义（resolveSkillDependencyOrder）：
 *   - 输入为 skill 依赖图（id + dependencies）。
 *   - 返回拓扑序（依赖先装），遇环 A→B→A 抛 SkillDependencyCycleError。
 *   - dependencies 里不在本集合内的 id 视为外部依赖，不参与内部拓扑约束。
 */
import { isValidSkillPackageId } from './skill-package.js'

/** 子技能引用（composition 内一项）。 */
export interface SkillSubskillRefV1 {
  readonly skillId: string
  readonly order: number
  readonly label?: string
  readonly color?: string
}

/** Root/Subskill composition 读模型（GUI 只编辑这份 canonical composition）。 */
export interface SkillCompositionV1 {
  readonly schemaVersion: 1
  readonly rootSkillId: string
  readonly subskills: readonly SkillSubskillRefV1[]
  readonly requiredCapabilities: readonly string[]
  readonly optionalCapabilities: readonly string[]
}

/** 结构校验结果（validate 不落盘）。 */
export interface SkillCompositionValidationV1 {
  readonly schemaVersion: 1
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

/** 依赖环异常（A→B→A；cycle 为含首尾重复节点的路径）。 */
export class SkillDependencyCycleError extends Error {
  constructor(cycle: readonly string[]) {
    super(`Skill dependency cycle detected: ${cycle.join(' -> ')}`)
    this.name = 'SkillDependencyCycleError'
  }
}

/** 依赖图节点（拓扑排序 + 环检测输入）。 */
export interface SkillDependencyNodeV1 {
  readonly id: string
  readonly dependencies: readonly string[]
}

/** composition 结构校验。 */
export function validateSkillComposition(input: unknown): SkillCompositionValidationV1 {
  const errors: string[] = []
  const warnings: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { schemaVersion: 1, valid: false, errors: ['composition 必须是对象'], warnings }
  }
  const comp = input as Record<string, unknown>
  if (comp.schemaVersion !== 1) errors.push('schemaVersion 必须为 1')
  if (typeof comp.rootSkillId !== 'string' || comp.rootSkillId === '' || !isValidSkillPackageId(comp.rootSkillId)) {
    errors.push('rootSkillId 缺失或非法')
  }
  const subskills = comp.subskills
  if (!Array.isArray(subskills)) {
    errors.push('subskills 必须是数组')
  } else {
    const seenOrder = new Set<number>()
    for (let i = 0; i < subskills.length; i++) {
      const sub = subskills[i]
      if (typeof sub !== 'object' || sub === null) {
        errors.push(`subskills[${i}] 必须是对象`)
        continue
      }
      const record = sub as Record<string, unknown>
      if (typeof record.skillId !== 'string' || record.skillId === '' || !isValidSkillPackageId(record.skillId)) {
        errors.push(`subskills[${i}].skillId 缺失或非法`)
      }
      if (typeof record.order !== 'number' || !Number.isInteger(record.order) || record.order < 0) {
        errors.push(`subskills[${i}].order 必须为非负整数`)
      } else if (seenOrder.has(record.order)) {
        errors.push(`subskills[${i}].order 重复: ${record.order}`)
      } else {
        seenOrder.add(record.order)
      }
    }
  }
  for (const key of ['requiredCapabilities', 'optionalCapabilities'] as const) {
    const list = comp[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      errors.push(`${key} 必须是数组`)
      continue
    }
    for (const item of list) {
      if (typeof item !== 'string' || item.trim() === '') errors.push(`${key} 含空或非字符串 capability`)
    }
  }
  return { schemaVersion: 1, valid: errors.length === 0, errors, warnings }
}

/** DFS 三色检测：返回含重复首尾节点的环路径（A→B→A）。 */
function findDependencyCycle(skills: readonly SkillDependencyNodeV1[]): string[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const state = new Map<string, 'visiting' | 'visited'>()
  const path: string[] = []
  const dfs = (id: string): string[] | null => {
    state.set(id, 'visiting')
    path.push(id)
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dep)) continue
      const current = state.get(dep)
      if (current === 'visiting') {
        const start = path.indexOf(dep)
        return [...path.slice(start), dep]
      }
      if (current === 'visited') continue
      const result = dfs(dep)
      if (result !== null) return result
    }
    path.pop()
    state.set(id, 'visited')
    return null
  }
  for (const node of skills) {
    if (state.has(node.id)) continue
    const cycle = dfs(node.id)
    if (cycle !== null) return cycle
  }
  return []
}

/** 依赖拓扑排序（依赖先装）；存在环时抛 SkillDependencyCycleError。 */
export function resolveSkillDependencyOrder(skills: readonly SkillDependencyNodeV1[]): readonly string[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const node of skills) {
    indegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }
  for (const node of skills) {
    for (const dep of node.dependencies) {
      if (!byId.has(dep)) continue
      adjacency.get(dep)!.push(node.id)
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const dependent of adjacency.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
  }
  if (order.length < skills.length) {
    const cycle = findDependencyCycle(skills)
    throw new SkillDependencyCycleError(cycle.length > 0 ? cycle : skills.map((s) => s.id))
  }
  return order
}
