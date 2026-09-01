/**
 * F6 P0-B2 + B6 补洞单（20260828）：Project Warehouse read model。
 *
 * Material View / Relation View 共用的分页只读投影——全部从既有 canonical truth
 * （artifacts/views/notes/connected_conversations/resources/scopes/workspaces/
 * workspace memberships/relations/birth_run_id）现算，零新表零第二套 membership。
 * B6 P0-B：聚合物种（context/workflow/scene/collection）进入 read model——
 * entityRef 可直接转换为稳定 AssemblySourceRefV1（scene.id 即 workspaceId）。
 * B6 P0-C：artifact 行带 truthful visualFamily/mimeType/fileName——与 web
 * detectFileIdentity 同一 taxonomy（video/audio/pdf/ppt/image/markdown/link/archive/file），
 * 从 canonical artifact.kind + FileRecord.mimeType + ResourceDescriptor.source 派生，
 * 不建 Warehouse 专属 taxonomy；前端禁止用 title/extension 猜 morphology。
 */
import type {
  ResourceDescriptorV0,
  WarehouseItemV1,
  WarehouseQueryV1,
  WarehouseSnapshotV1,
} from '@local-creative-os/contracts'
import type { Artifact } from '@local-creative-os/domain'
import type { SqliteMetadataRepository } from './metadata-repository.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** cursor 编码：`offset:<n>`（简单稳定；排序键为 updatedAt 降序 + id 稳定序）。 */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  const match = /^offset:(\d+)$/.exec(cursor)
  return match === null ? 0 : Number(match[1]!)
}

interface NeighborEntry {
  count: number
  kinds: Map<string, number>
}

/** 与 web detectFileIdentity 同源的视觉家族（顺序即优先级；来源全是 canonical 字段）。 */
function deriveVisualFamily(input: {
  readonly artifactKind: Artifact['kind']
  readonly mimeType?: string
  readonly descriptor?: ResourceDescriptorV0
}): { readonly family: NonNullable<WarehouseItemV1['visualFamily']>; readonly fileName?: string } {
  const mime = (input.mimeType ?? '').toLowerCase()
  const source = input.descriptor?.source
  const name = (source?.originalName ?? '').toLowerCase()
  if (input.artifactKind === 'image' || mime.startsWith('image/')) return { family: 'image', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (input.artifactKind === 'pdf' || mime.includes('pdf') || name.endsWith('.pdf')) return { family: 'pdf', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (input.artifactKind === 'presentation' || mime.includes('presentation') || /\.(ppt|pptx|key)$/.test(name)) return { family: 'ppt', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi)$/.test(name)) return { family: 'video', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/.test(name)) return { family: 'audio', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (input.artifactKind === 'markdown' || mime.includes('markdown') || mime.startsWith('text/') || /\.(md|markdown|txt|json)$/.test(name)) return { family: 'markdown', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  if (source?.kind === 'url' || source?.normalizedUrl !== undefined) return { family: 'link' }
  if (mime.includes('zip') || mime.includes('archive') || mime.includes('gzip') || mime.includes('tar') || /\.(zip|rar|7z|tar|gz)$/.test(name)) return { family: 'archive', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
  return { family: 'file', ...(source?.originalName === undefined ? {} : { fileName: source.originalName }) }
}

export class WarehouseService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  query(projectId: string, query: WarehouseQueryV1 = {}): WarehouseSnapshotV1 {
    const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT))
    const offset = decodeCursor(query.cursor)
    const kinds = new Set(query.kinds ?? ['artifact', 'note', 'conversation', 'resource', 'context', 'workflow', 'scene', 'collection'])
    const needle = query.search?.trim().toLocaleLowerCase('en-US') ?? ''

    // usage 预投影：viewId → 出现次数（workspace memberships）。
    const usageByView = new Map<string, number>()
    for (const membership of this.repository.listProjectWorkspaceMemberships(projectId as never)) {
      const key = String(membership.artifactViewId)
      usageByView.set(key, (usageByView.get(key) ?? 0) + 1)
    }
    // 裁决 1：note 的 scene 投影计数（workspace_entity_memberships）。
    const noteUsageByEntity = new Map<string, number>()
    for (const membership of this.repository.listProjectWorkspaceEntityMemberships(projectId as never)) {
      if (membership.entityType !== 'note') continue
      noteUsageByEntity.set(membership.entityId, (noteUsageByEntity.get(membership.entityId) ?? 0) + 1)
    }
    // relation 邻居预投影：entityId → 邻居计数 + kind 直方图（scope/workspace 端点同样命中）。
    const relations = this.repository.getRelations(projectId)
    const neighborsByEntity = new Map<string, NeighborEntry>()
    for (const relation of relations) {
      for (const entityId of [String(relation.sourceEntityId), String(relation.targetEntityId)]) {
        const entry = neighborsByEntity.get(entityId) ?? { count: 0, kinds: new Map<string, number>() }
        entry.count += 1
        entry.kinds.set(relation.kind, (entry.kinds.get(relation.kind) ?? 0) + 1)
        neighborsByEntity.set(entityId, entry)
      }
    }

    const items: WarehouseItemV1[] = []

    if (kinds.has('artifact')) {
      for (const artifact of this.repository.getArtifacts(projectId)) {
        const title = artifact.title
        const updatedAt = (artifact as { readonly updatedAt?: string }).updatedAt
        if (needle !== '' && !title.toLocaleLowerCase('en-US').includes(needle)) continue
        const views = this.repository.getArtifactViews(String(artifact.id))
        const viewId = views[0]?.id
        const usageCount = views.reduce((sum, view) => sum + (usageByView.get(String(view.id)) ?? 0), 0)
        const neighbor = neighborsByEntity.get(String(artifact.id))
        const birthRunId = this.repository.getArtifactBirthRunId(String(artifact.id))
        // P0-C：canonical mimeType（current revision 的 FileRecord）+ descriptor（resource 源信息）。
        let mimeType: string | undefined
        const currentRevision = artifact.currentRevisionId === undefined ? undefined : this.repository.getArtifactRevision(String(artifact.currentRevisionId))
        if (currentRevision !== undefined) {
          const fileRecord = this.repository.getFileRecord(String(currentRevision.fileRecordId))
          mimeType = fileRecord?.mimeType
        }
        const descriptor = currentRevision === undefined
          ? undefined
          : this.repository.getResourceDescriptorForRevision(String(artifact.id), String(currentRevision.id))
        const visual = deriveVisualFamily({ artifactKind: artifact.kind, ...(mimeType === undefined ? {} : { mimeType }), ...(descriptor === undefined ? {} : { descriptor }) })
        let fileName: string | undefined = visual.fileName
        if (fileName === undefined && currentRevision !== undefined) {
          const fileRecord = this.repository.getFileRecord(String(currentRevision.fileRecordId))
          fileName = fileRecord === undefined ? undefined : String(fileRecord.observedPath).split(/[\\/]/).at(-1)
        }
        items.push({
          schemaVersion: 1,
          entityRef: { type: 'artifact', id: String(artifact.id), ...(viewId === undefined ? {} : { viewId: String(viewId) }) },
          kind: 'artifact',
          title,
          ...(updatedAt === undefined ? {} : { updatedAt }),
          usageCount,
          visualFamily: visual.family,
          ...(mimeType === undefined ? {} : { mimeType }),
          ...(fileName === undefined ? {} : { fileName }),
          ...(birthRunId === undefined ? {} : { provenance: { origin: 'run-return' as const, birthRunId: String(birthRunId) } }),
          ...(neighbor === undefined ? {} : {
            relationHint: {
              neighborCount: neighbor.count,
              topKinds: [...neighbor.kinds.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => kind),
            },
          }),
        })
      }
    }

    if (kinds.has('note')) {
      for (const note of this.repository.getNotes(projectId)) {
        const updatedAt = (note as { readonly updatedAt?: string }).updatedAt
        if (needle !== '' && !note.body.toLocaleLowerCase('en-US').includes(needle)) continue
        items.push({
          schemaVersion: 1,
          entityRef: { type: 'note', id: String(note.id) },
          kind: 'note',
          title: note.body.slice(0, 60),
          ...(updatedAt === undefined ? {} : { updatedAt }),
          usageCount: noteUsageByEntity.get(String(note.id)) ?? 0,
        })
      }
    }

    if (kinds.has('conversation')) {
      for (const connected of this.repository.listConnectedConversations(projectId)) {
        if (needle !== '' && !connected.label.toLocaleLowerCase('en-US').includes(needle)) continue
        items.push({
          schemaVersion: 1,
          entityRef: { type: 'conversation', id: String(connected.id) },
          kind: 'conversation',
          title: connected.label,
          updatedAt: connected.updatedAt,
          usageCount: 0,
        })
      }
    }

    if (kinds.has('resource')) {
      for (const descriptor of this.repository.listResourceDescriptors(projectId)) {
        const title = descriptor.display.title
        if (needle !== '' && !title.toLocaleLowerCase('en-US').includes(needle)) continue
        items.push({
          schemaVersion: 1,
          entityRef: { type: 'resource', id: String(descriptor.resourceId) },
          kind: 'resource',
          title,
          usageCount: 0,
        })
      }
    }

    // ---- B6 P0-B：聚合物种（context/workflow/collection ← scopes；scene ← workspaces）。----
    if (kinds.has('context') || kinds.has('workflow') || kinds.has('collection')) {
      for (const scope of this.repository.getScopes(projectId)) {
        if (scope.kind !== 'context' && scope.kind !== 'workflow' && scope.kind !== 'collection') continue
        if (!kinds.has(scope.kind)) continue
        if (needle !== '' && !scope.name.toLocaleLowerCase('en-US').includes(needle)) continue
        const neighbor = neighborsByEntity.get(String(scope.id))
        items.push({
          schemaVersion: 1,
          entityRef: { type: scope.kind, id: String(scope.id) },
          kind: scope.kind,
          title: scope.name,
          updatedAt: scope.updatedAt,
          usageCount: 0,
          ...(neighbor === undefined ? {} : {
            relationHint: {
              neighborCount: neighbor.count,
              topKinds: [...neighbor.kinds.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => kind),
            },
          }),
        })
      }
    }

    if (kinds.has('scene')) {
      for (const workspace of this.repository.getWorkspaces(projectId)) {
        if (needle !== '' && !workspace.name.toLocaleLowerCase('en-US').includes(needle)) continue
        const neighbor = neighborsByEntity.get(String(workspace.id))
        items.push({
          schemaVersion: 1,
          entityRef: { type: 'scene', id: String(workspace.id) },
          kind: 'scene',
          title: workspace.name,
          updatedAt: workspace.updatedAt,
          usageCount: 0,
          ...(neighbor === undefined ? {} : {
            relationHint: {
              neighborCount: neighbor.count,
              topKinds: [...neighbor.kinds.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => kind),
            },
          }),
        })
      }
    }

    // 排序：updatedAt 降序（缺省排最后）+ id 稳定序。
    items.sort((left, right) => {
      const leftTime = left.updatedAt ?? ''
      const rightTime = right.updatedAt ?? ''
      if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1
      return left.entityRef.id < right.entityRef.id ? -1 : 1
    })

    // provenance 过滤（排序后过滤不影响稳定性）。
    const filtered = query.provenanceOrigin === undefined
      ? items
      : items.filter((item) => item.provenance?.origin === query.provenanceOrigin)

    // usedHere 投影：workspace target → membership 命中。
    let resultItems = filtered
    if (query.usedHereTarget?.kind === 'workspace') {
      const members = new Set(this.repository.listWorkspaceMembers(query.usedHereTarget.id as never).map((member) => String(member.artifactViewId)))
      resultItems = filtered.map((item) => ({
        ...item,
        ...(item.kind === 'artifact' && item.entityRef.viewId !== undefined
          ? { usedHere: members.has(item.entityRef.viewId) }
          : {}),
      }))
      // usedHere 轴下 artifact 只显示命中的（Material View 的 Used Here 过滤语义）。
      resultItems = resultItems.filter((item) => item.kind !== 'artifact' || item.usedHere === true)
    }

    const totalApprox = resultItems.length
    const page = resultItems.slice(offset, offset + limit)
    return {
      schemaVersion: 1,
      projectId,
      items: page,
      ...(offset + limit < totalApprox ? { nextCursor: `offset:${offset + limit}` } : {}),
      totalApprox,
    }
  }
}