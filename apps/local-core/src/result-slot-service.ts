/**
 * F6 P0-D5（20260828）：ResultSlot——Blank Result 的 authoritative truth。
 *
 * 生命周期：empty →(claim by run)→ running →(run return pending)→ review
 *           →(accept)→ materialized（绑定 canonical ArtifactView，restart 稳定）。
 *
 * 红线：不复制 output 节点再删槽；不靠位置猜替换；ResultSlot 自身不是 Artifact
 * provenance；materialize 后槽位保留（状态可查），remove 是显式动作。
 */
import { randomUUID } from 'node:crypto'
import type { ResultSlotV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

export class ResultSlotService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  create(input: {
    readonly projectId: string
    readonly scopeId: string
    readonly workspaceId?: string
    readonly x: number
    readonly y: number
    readonly width?: number
    readonly height?: number
  }): ResultSlotV0 {
    if (this.repository.getProject(input.projectId) === undefined) throw new Error('Project not found.')
    const scopes = this.repository.getScopes(input.projectId)
    if (!scopes.some((scope) => String(scope.id) === input.scopeId)) throw new Error('Scope does not belong to the project.')
    if (input.workspaceId !== undefined && String(this.repository.getWorkspace(input.workspaceId)?.projectId ?? '') !== input.projectId) {
      throw new Error('Workspace does not belong to the project.')
    }
    const now = new Date().toISOString()
    const slot: ResultSlotV0 = {
      schemaVersion: 0,
      id: `result-slot-${randomUUID()}`,
      projectId: input.projectId,
      scopeId: input.scopeId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      position: { x: input.x, y: input.y },
      ...(input.width === undefined || input.height === undefined ? {} : { size: { width: input.width, height: input.height } }),
      status: 'empty',
      createdAt: now,
      updatedAt: now,
    }
    this.repository.createResultSlot(slot)
    return slot
  }

  get(slotId: string): ResultSlotV0 | undefined {
    return this.repository.getResultSlot(slotId)
  }

  list(projectId: string): readonly ResultSlotV0[] {
    return this.repository.listResultSlots(projectId)
  }

  /** Run 创建/派发时占用槽位（empty→running；幂等：同 run 重复 claim 不变）。 */
  claim(slotId: string, runId: string): ResultSlotV0 {
    const slot = this.repository.getResultSlot(slotId)
    if (slot === undefined) throw new Error('Result slot not found.')
    if (slot.status === 'materialized') throw new Error('Result slot is already materialized.')
    if (slot.runId !== undefined && slot.runId !== runId) throw new Error('Result slot is claimed by another run.')
    if (slot.status === 'running' && slot.runId === runId) return slot
    return this.repository.updateResultSlot(slotId, { status: 'running', runId })
  }

  /** Run return 进入 review 时推进状态（running→review；幂等）。 */
  markReview(slotId: string, runId: string): ResultSlotV0 {
    const slot = this.repository.getResultSlot(slotId)
    if (slot === undefined) throw new Error('Result slot not found.')
    if (slot.runId !== undefined && slot.runId !== runId) throw new Error('Result slot is claimed by another run.')
    if (slot.status === 'materialized') return slot
    return this.repository.updateResultSlot(slotId, { status: 'review', runId })
  }

  /** accept 后物化：绑定 canonical view/artifact（保留位置；不复制节点）。 */
  materialize(slotId: string, runId: string, artifactId: string, artifactViewId: string): ResultSlotV0 {
    const slot = this.repository.getResultSlot(slotId)
    if (slot === undefined) throw new Error('Result slot not found.')
    if (slot.runId !== undefined && slot.runId !== runId) throw new Error('Result slot is claimed by another run.')
    if (slot.status === 'materialized') {
      // 幂等：同一 run 重复 materialize 返回现状；不同 view = 冲突（fail-close）。
      if (slot.artifactViewId === artifactViewId) return slot
      throw new Error('Result slot already materialized with a different view.')
    }
    return this.repository.updateResultSlot(slotId, { status: 'materialized', artifactId, artifactViewId, runId })
  }

  /** Run 被拒/取消后释放槽位回到 empty（materialized 不可逆，走 remove）。 */
  release(slotId: string, runId: string): ResultSlotV0 {
    const slot = this.repository.getResultSlot(slotId)
    if (slot === undefined) throw new Error('Result slot not found.')
    if (slot.runId !== undefined && slot.runId !== runId) throw new Error('Result slot is claimed by another run.')
    if (slot.status === 'materialized') return slot
    return this.repository.updateResultSlot(slotId, { status: 'empty', runId: undefined })
  }

  remove(slotId: string): void {
    if (this.repository.getResultSlot(slotId) === undefined) throw new Error('Result slot not found.')
    this.repository.deleteResultSlot(slotId)
  }

  /** run→slot 反查（RunRecipe / accept 集成用）。 */
  slotForRun(runId: string): ResultSlotV0 | undefined {
    return this.repository.getResultSlotByRun(runId)
  }
}
