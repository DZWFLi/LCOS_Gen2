import { parseRailwayStoredRefV1, railwayStableKeyV1 } from '@local-creative-os/contracts'
import type { RailwayDestinationV1, RailwayOrderV1, RailwaySnapshotV1, RailwayStoredRefV1, RailwaySurfaceKindV1 } from '@local-creative-os/contracts'
import type { Workspace } from '@local-creative-os/domain'
import type { SqliteMetadataRepository } from './metadata-repository.js'

const surfaces = ['main', 'context', 'workflow'] as const
const surfaceOf = (workspace: Workspace): RailwaySurfaceKindV1 | undefined =>
  surfaces.includes(workspace.preferredSurface as RailwaySurfaceKindV1) ? workspace.preferredSurface as RailwaySurfaceKindV1 : undefined

/** Canonical navigation read model. Workspace is a named compatibility source,
 * not a second Worksite DB. A collection never acquires a canvas by being opened. */
export class RailwayDestinationService {
  constructor(private readonly metadata: SqliteMetadataRepository) {}

  read(projectId: string): RailwaySnapshotV1 {
    const project = this.metadata.get(projectId)
    if (!project) throw new Error('项目不存在。')
    const workspaces = project.workspaces
    const roots = new Set(project.scopes.filter((s) => s.kind === 'root').map((s) => String(s.id)))
    const record = this.metadata.getRailwayOrderRecord(projectId)
    const raw = record?.orderedRefs
    const isV1 = !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as {schemaVersion?: unknown}).schemaVersion === 1
      && Array.isArray((raw as {orderedRefs?: unknown}).orderedRefs)
    const values: unknown[] = isV1 ? (raw as {orderedRefs: unknown[]}).orderedRefs : Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
    const legacy = (value: unknown): RailwayStoredRefV1 => {
      const r = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      return { kind: 'legacy', projectId, legacyKind: typeof r.kind === 'string' ? r.kind : 'unknown', legacyViewId: typeof r.viewId === 'string' ? r.viewId : '', raw: value }
    }
    const refs: RailwayStoredRefV1[] = []
    const seen = new Set<string>()
    for (const value of values) {
      let ref = parseRailwayStoredRefV1(value, projectId)
      if (!ref && !isV1 && value && typeof value === 'object' && Object.keys(value).every((key) => key === 'kind' || key === 'viewId')) {
        const r = value as Record<string, unknown>
        const workspace = workspaces.find((w) => String(w.id) === r.viewId)
        if (r.kind === 'scene' && workspace && !roots.has(String(workspace.scopeId)) && workspace.canvasId && surfaceOf(workspace))
          ref = {kind: 'worksite', projectId, worksiteId: String(workspace.id)}
        if (r.kind === 'context' || r.kind === 'workflow') {
          const matches = workspaces.filter((w) => roots.has(String(w.scopeId)) && w.preferredSurface === r.kind)
          if (matches.length === 1 && (String(matches[0]!.id) === r.viewId || String(matches[0]!.scopeId) === r.viewId))
            ref = {kind: 'surface_root', projectId, surface: r.kind}
        }
      }
      ref ??= legacy(value)
      const key = railwayStableKeyV1(ref)
      if (!seen.has(key)) { seen.add(key); refs.push(ref) }
    }
    const order: RailwayOrderV1 = {schemaVersion: 1, projectId, orderedRefs: refs, version: record?.version ?? 0, updatedAt: record?.updatedAt ?? ''}
    const resolve = (ref: RailwayStoredRefV1): RailwayDestinationV1 => {
      const base = { key: railwayStableKeyV1(ref), ref, accepts: [] as readonly ('artifactView' | 'note')[] }
      if (ref.kind === 'legacy') return {...base, role: 'legacy', label: ref.legacyViewId || '无法识别的旧目的地', available: false, reason: '旧记录尚未确认用途，可保留或移除；不会自动变成工作现场。'}
      if (ref.kind === 'receiver_conversation') {
        const conversation = this.metadata.getConnectedConversation(projectId, ref.connectedConversationId)
        const available = !!conversation && !conversation.conversationRef.startsWith('pending-')
        return {...base, role: 'receiver', label: conversation?.label || '原会话不可用', available,
          ...(available ? {} : {reason: '会话已移除或身份尚未确认。'})}
      }
      const candidates = ref.kind === 'surface_root'
        ? workspaces.filter((w) => roots.has(String(w.scopeId)) && w.preferredSurface === ref.surface)
        : workspaces.filter((w) => String(w.id) === ref.worksiteId && !roots.has(String(w.scopeId)))
      const workspace = candidates.length === 1 ? candidates[0] : undefined
      const surface = workspace && surfaceOf(workspace)
      const canvasId = workspace?.canvasId
      const sharedCanvas = canvasId ? workspaces.filter((w) => w.canvasId === canvasId).length > 1 : false
      const available = !!workspace && !!canvasId && !!surface && !sharedCanvas
      const reason = !workspace ? '目的地不存在或身份不唯一。' : !surface ? '现场类型尚未确认。'
        : !canvasId ? '这个现场还没有画布，暂不能进入或接收材料。' : sharedCanvas ? '多个现场共用同一画布，请先修复现场绑定。' : undefined
      return {...base, role: ref.kind === 'surface_root' ? 'surface' : 'worksite', label: workspace?.name || '原现场不可用', available,
        ...(reason ? {reason} : {}), ...(surface ? {surface} : {}), ...(canvasId ? {canvasId} : {}),
        ...(workspace ? {workspaceId: String(workspace.id)} : {}),
        accepts: available && ref.kind === 'worksite' ? ['artifactView', 'note'] : []}
    }
    const destinations = refs.map(resolve)
    const candidateRefs: RailwayStoredRefV1[] = workspaces.filter((w) => !roots.has(String(w.scopeId)))
      .map((w) => ({kind: 'worksite', projectId, worksiteId: String(w.id)}))
    for (const c of this.metadata.listConnectedConversations(projectId)) {
      if (!c.conversationRef.startsWith('pending-')) candidateRefs.push({kind:'receiver_conversation',projectId,connectedConversationId:c.id})
    }
    const candidates = candidateRefs.filter((r) => !seen.has(railwayStableKeyV1(r))).map(resolve)
      .sort((a,b) => a.label.localeCompare(b.label, 'zh-CN') || a.key.localeCompare(b.key))
    return {schemaVersion: 1, projectId, order, destinations, candidates, migrationRequired: !!record && !isV1}
  }

  /** A read-only Portal address; a workspace need not be pinned to Railway. */
  resolveWorkspace(projectId: string, workspaceId: string): RailwayDestinationV1 {
    const project = this.metadata.get(projectId)
    if (!project) throw new Error('项目不存在。')
    const matches = project.workspaces.filter((w) => String(w.id) === workspaceId)
    const workspace = matches.length === 1 ? matches[0] : undefined
    const ref = {kind: 'worksite' as const, projectId, worksiteId: workspaceId}
    const surface = workspace && surfaceOf(workspace)
    const canvasId = workspace?.canvasId
    const uniqueCanvas = !!canvasId && project.workspaces.filter((w) => w.canvasId === canvasId).length === 1
    const available = !!workspace && !!surface && uniqueCanvas
    return {key: railwayStableKeyV1(ref), ref, role: 'worksite', label: workspace?.name || '原现场不可用', available,
      ...(workspace ? {workspaceId} : {}), ...(surface ? {surface} : {}), ...(canvasId ? {canvasId} : {}),
      accepts: available ? ['artifactView', 'note'] : [],
      ...(!available ? {reason: !workspace ? '原现场不存在。' : !surface ? '现场类型尚未确认。'
        : !canvasId ? '现场画布尚未就绪。' : '多个现场共用同一画布，请先修复绑定。'} : {}),
    }
  }

  save(projectId: string, values: unknown, expectedVersion: number): RailwaySnapshotV1 {
    if (!Array.isArray(values)) throw new Error('目的地顺序必须是数组。')
    const refs = values.map((value) => parseRailwayStoredRefV1(value, projectId))
    if (refs.some((ref) => ref === undefined)) throw new Error('目的地身份无效或属于另一个项目。')
    const orderedRefs = refs as RailwayStoredRefV1[]
    const keys = orderedRefs.map(railwayStableKeyV1)
    if (new Set(keys).size !== keys.length) throw new Error('目的地不能重复。')
    this.metadata.saveRailwayOrderRecord(projectId, {schemaVersion: 1, orderedRefs}, expectedVersion, () => {
      const current = this.read(projectId)
      const retained = new Set(current.order.orderedRefs.map(railwayStableKeyV1))
      const candidates = new Map(current.candidates.map((item) => [item.key, item]))
      for (const ref of orderedRefs) {
        const key = railwayStableKeyV1(ref)
        if (retained.has(key)) continue
        if (ref.kind === 'legacy' || ref.kind === 'surface_root' || !candidates.get(key)?.available)
          throw new Error('目的地已变化或尚不可用，请重新读取后添加。')
      }
    })
    return this.read(projectId)
  }
}
