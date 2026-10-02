import { parseRailwayStoredRefV1, railwayStableKeyV1 } from '@local-creative-os/contracts'
import type { RailwayReceiveRequestV1, RailwayReceiveOutcomeV1, PortalReceiveRequestV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { MutationSafetyService } from './mutation-safety-service.js'
import { RailwayDestinationService } from './railway-destination-service.js'

/** Source-stay only. No geometry, new Worksite, provider send, or physical transfer. */
export class RailwayReceiveService {
  constructor(private readonly metadata: SqliteMetadataRepository, private readonly mutations: MutationSafetyService) {}

  receive(projectId: string, value: unknown, signal?: AbortSignal): RailwayReceiveOutcomeV1 {
    const request = parseRailwayReceiveRequest(projectId, value)
    if (signal?.aborted) throw new Error('投递已取消，未提交。')
    const destinations = new RailwayDestinationService(this.metadata)
    return this.mutations.receiveWorkspaceBatch(request, () => {
      if (signal?.aborted) throw new Error('投递已取消，未提交。')
      const current = destinations.read(projectId)
      if (current.order.version !== request.expectedOrderVersion) throw new Error('目的地顺序已变化，请重新预览后投递。')
      const destination = current.destinations.find((d) => d.key === railwayStableKeyV1(request.destination))
      if (!destination?.available || destination.ref.kind !== 'worksite') throw new Error(destination?.reason ?? '目的地已移除；本批未投递。')
      if (destination.canvasId !== request.expectedCanvasId) throw new Error('目的地画布已变化；本批未投递。')
      if (request.sourceCanvasId === destination.canvasId) throw new Error('材料已经在当前现场，请直接在画布整理。')
      return destination
    })
  }

  receivePortal(projectId: string, value: unknown, signal?: AbortSignal): RailwayReceiveOutcomeV1 {
    const request = parsePortalReceiveRequest(projectId, value)
    if (signal?.aborted) throw new Error('投递已取消，未提交。')
    return this.mutations.receiveWorkspaceBatch(request, () => {
      if (signal?.aborted) throw new Error('投递已取消，未提交。')
      const destination = new RailwayDestinationService(this.metadata).resolveWorkspace(projectId, request.destination.kind === 'worksite' ? request.destination.worksiteId : '')
      if (!destination.available) throw new Error(destination.reason ?? '入口目标不可用。')
      if (destination.canvasId !== request.expectedCanvasId) throw new Error('入口目标画布已变化，请重新打开入口；本批未投递。')
      const source = this.metadata.getWorkspaces(projectId).filter((w) => w.canvasId === request.sourceCanvasId)
      if (source.length !== 1) throw new Error('来源现场不存在或不属于当前项目。')
      if (request.sourceCanvasId === destination.canvasId) throw new Error('材料已经在当前现场，请直接整理。')
      return destination
    })
  }

  lookup(projectId: string, operationId: string, viaPortal = false): RailwayReceiveOutcomeV1 | undefined {
    if (!operationId.startsWith(viaPortal ? 'portal-receive:' : 'railway-receive:')) return undefined
    const stored = this.metadata.getCurationReceipt(operationId)
    if (stored?.railway?.request.projectId !== projectId) return undefined
    if (stored.changeSetId && this.metadata.getMutationChangeSet(stored.changeSetId)?.status !== 'applied') throw new Error('原投递已撤销。')
    return stored.railway.outcome
  }
}

export function parseRailwayReceiveRequest(projectId: string, value: unknown): RailwayReceiveRequestV1 {
  return parseWorkspaceReceiveRequest(projectId, value, false) as RailwayReceiveRequestV1
}
export function parsePortalReceiveRequest(projectId: string, value: unknown): PortalReceiveRequestV1 {
  return parseWorkspaceReceiveRequest(projectId, value, true) as PortalReceiveRequestV1
}
function parseWorkspaceReceiveRequest(projectId: string, value: unknown, viaPortal: boolean): RailwayReceiveRequestV1 | PortalReceiveRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('投递请求无效。')
  const r = value as Record<string,unknown>
  const destination = parseRailwayStoredRefV1(r.destination, projectId)
  if (r.schemaVersion !== 1 || r.projectId !== projectId || destination?.kind !== 'worksite'
    || typeof r.operationId !== 'string' || !(viaPortal ? /^portal-receive:[A-Za-z0-9_-]{16,100}$/ : /^railway-receive:[A-Za-z0-9_-]{16,100}$/).test(r.operationId)
    || (viaPortal ? r.viaPortal !== true || typeof r.sourceCanvasId !== 'string' || !r.sourceCanvasId.trim()
      : !Number.isSafeInteger(r.expectedOrderVersion) || Number(r.expectedOrderVersion) < 0)
    || typeof r.expectedCanvasId !== 'string' || !r.expectedCanvasId
    || (r.sourceCanvasId !== undefined && (typeof r.sourceCanvasId !== 'string' || !r.sourceCanvasId))
    || !Array.isArray(r.sourceRefs) || !r.sourceRefs.length
    || Object.keys(r).some((key) => !['schemaVersion','projectId','operationId','destination',viaPortal ? 'viaPortal' : 'expectedOrderVersion','expectedCanvasId','sourceCanvasId','sourceRefs'].includes(key)))
    throw new Error('投递身份、材料或目标版本无效。')
  const sourceRefs: RailwayReceiveRequestV1['sourceRefs'][number][] = []
  const seen = new Set<string>()
  for (const v of r.sourceRefs) {
    if (!v || typeof v !== 'object' || !['artifactView','note'].includes(v.kind) || typeof v.id !== 'string' || !v.id.trim()
      || Object.keys(v).some((key) => !['kind','id'].includes(key))) throw new Error('整组选中材料尚不能原子投递，请使用已有材料视图或笔记。')
    const key = JSON.stringify([v.kind,v.id])
    if (seen.has(key)) throw new Error('选中材料不能重复。')
    seen.add(key); sourceRefs.push({kind:v.kind,id:v.id})
  }
  if (viaPortal) return {schemaVersion:1,projectId,operationId:r.operationId,destination,viaPortal:true,
    expectedCanvasId:String(r.expectedCanvasId),sourceCanvasId:String(r.sourceCanvasId),sourceRefs}
  return {schemaVersion:1,projectId,operationId:r.operationId,destination,expectedOrderVersion:Number(r.expectedOrderVersion),
    expectedCanvasId:r.expectedCanvasId,...(typeof r.sourceCanvasId === 'string' ? {sourceCanvasId:r.sourceCanvasId} : {}),sourceRefs}
}
