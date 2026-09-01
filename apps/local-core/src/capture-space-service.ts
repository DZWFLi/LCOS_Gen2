import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CaptureMaterializeResultV1,
  CaptureSpaceOrganizeResultV1,
  CaptureSpacePayloadPreviewV1,
  CaptureSpacePresentationV1,
  CaptureSpaceRegionV1,
  CaptureSpaceViewV1,
  CaptureStagingItemV0,
} from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { CaptureStagingService } from './capture-staging-service.js'
import type { UniversalResourceImportService } from './resources/universal-resource-import-service.js'
import type { CapturePlacementService } from './capture-placement-service.js'
import type { IntelligenceProviderService } from './intelligence-provider-service.js'
import { createTextArtifact } from './text-artifact-service.js'

const ORGANIZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'captureIds'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 48 },
          captureIds: { type: 'array', items: { type: 'string' }, maxItems: 200 },
          projectHintId: { type: 'string' },
        },
      },
    },
  },
} as const

function titleFor(item: CaptureStagingItemV0): string {
  const title = String((item.source as { title?: string })?.title ?? '').trim()
  if (title) return title
  if (item.payloadRef.startsWith('http')) {
    try { return new URL(item.payloadRef).hostname } catch { return item.payloadRef.slice(0, 80) }
  }
  const tail = item.payloadRef.split(/[\\/]/).at(-1)
  return tail || item.kind
}

function kindGroup(item: CaptureStagingItemV0): string {
  if (item.kind.includes('image') || item.kind === 'screenshot') return '视觉参考'
  if (item.kind.includes('selection') || item.kind.includes('text') || item.kind === 'conversation_snapshot') return '文字与对话'
  if (item.kind.includes('page') || item.kind.includes('link')) return '网页与链接'
  if (item.kind === 'local_file') return '本地文件'
  return '未分类'
}

function layoutGroups(groups: Array<{ label: string; captureIds: string[]; projectHintId?: string }>, items: readonly CaptureStagingItemV0[], version: number): CaptureSpacePresentationV1 {
  const byId = new Map(items.map((item) => [item.id, item]))
  const views: CaptureSpaceViewV1[] = []
  const regions: CaptureSpaceRegionV1[] = []
  const used = new Set<string>()
  let cursorX = 120
  let cursorY = 120
  const maxColumns = 3
  for (const [groupIndex, group] of groups.entries()) {
    const ids = group.captureIds.filter((id) => byId.has(id) && !used.has(id))
    if (!ids.length) continue
    ids.forEach((id) => used.add(id))
    const columns = Math.min(maxColumns, Math.max(1, Math.ceil(Math.sqrt(ids.length))))
    const rows = Math.ceil(ids.length / columns)
    const width = columns * 252 + 48
    const height = rows * 176 + 78
    const x = cursorX
    const y = cursorY
    ids.forEach((id, index) => {
      const item = byId.get(id)!
      const col = index % columns
      const row = Math.floor(index / columns)
      const textLike = item.kind.includes('text') || item.kind.includes('selection') || item.kind === 'conversation_snapshot'
      views.push({ captureId: id, x: x + 24 + col * 252, y: y + 50 + row * 176, width: 224, height: textLike ? 140 : 150 })
    })
    regions.push({
      id: `capture-region-${groupIndex + 1}-${createHash('sha1').update(`${group.label}:${ids.join(',')}`).digest('hex').slice(0, 8)}`,
      label: group.label,
      captureIds: ids,
      x,
      y,
      width,
      height,
      ...(group.projectHintId ? { projectHintId: group.projectHintId } : {}),
    })
    cursorX += width + 48
    if (cursorX > 1180) {
      cursorX = 120
      cursorY += height + 56
    }
  }
  const remaining = items.filter((item) => !used.has(item.id))
  remaining.forEach((item, index) => {
    views.push({ captureId: item.id, x: 120 + (index % 4) * 252, y: cursorY + Math.floor(index / 4) * 176, width: 224, height: 148 })
  })
  return { schemaVersion: 1, version, views, regions, updatedAt: new Date().toISOString() }
}

export class CaptureSpaceService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly staging: CaptureStagingService,
    private readonly resources: UniversalResourceImportService,
    private readonly placement: CapturePlacementService,
    private readonly intelligence: IntelligenceProviderService,
    private readonly blobRoot: string,
  ) {}

  snapshot(limit = 500): { readonly items: readonly CaptureStagingItemV0[]; readonly pendingCount: number; readonly presentation: CaptureSpacePresentationV1 } {
    const items = this.staging.listPending(limit)
    return { items, pendingCount: items.length, presentation: this.metadata.getCaptureSpacePresentation() }
  }

  savePresentation(input: Omit<CaptureSpacePresentationV1, 'version' | 'updatedAt'>, expectedVersion?: number): CaptureSpacePresentationV1 {
    const pending = new Set(this.staging.listPending(2000).map((item) => item.id))
    const views = input.views.filter((view) => pending.has(view.captureId)).map((view) => ({
      ...view,
      width: Math.max(120, Math.min(680, Number(view.width) || 224)),
      height: Math.max(80, Math.min(720, Number(view.height) || 148)),
    }))
    const regions = input.regions.map((region) => ({ ...region, captureIds: region.captureIds.filter((id) => pending.has(id)) })).filter((region) => region.captureIds.length > 0)
    return this.metadata.saveCaptureSpacePresentation({ schemaVersion: 1, views, regions }, expectedVersion)
  }

  async preview(captureId: string): Promise<CaptureSpacePayloadPreviewV1> {
    const item = this.metadata.getCaptureStagingItem(captureId)
    if (!item) throw new Error('Capture item not found.')
    const ref = item.payloadRef
    if (/^https?:\/\//i.test(ref)) return { schemaVersion: 1, captureId, type: 'url', url: ref }
    if (!ref.startsWith('blob:')) return { schemaVersion: 1, captureId, type: 'local_path', path: ref }
    const bytes = await readFile(join(this.blobRoot, ref.slice('blob:'.length)))
    const textLike = item.kind === 'clipboard_text' || item.kind === 'web_selection' || item.kind === 'conversation_snapshot'
    if (textLike) {
      const max = 24_000
      return { schemaVersion: 1, captureId, type: 'text', text: bytes.subarray(0, max).toString('utf8'), ...(bytes.length > max ? { truncated: true } : {}) }
    }
    const maxImage = 2 * 1024 * 1024
    if ((item.kind === 'web_image' || item.kind === 'screenshot' || item.kind === 'clipboard_image') && bytes.length <= maxImage) {
      const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
      return { schemaVersion: 1, captureId, type: 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    }
    return { schemaVersion: 1, captureId, type: 'unknown' }
  }

  async organize(): Promise<CaptureSpaceOrganizeResultV1> {
    const items = this.staging.listPending(500)
    if (!items.length) {
      return { schemaVersion: 1, presentation: this.metadata.getCaptureSpacePresentation(), usedModel: false, summary: 'Capture Space 目前没有待整理材料。' }
    }
    const projects = this.metadata.listProjects().map((project) => ({ id: String(project.id), label: project.name }))
    const modelInput = await Promise.all(items.slice(0, 160).map(async (item) => {
      let excerpt = ''
      if (item.payloadRef.startsWith('blob:') && (item.kind === 'clipboard_text' || item.kind === 'web_selection' || item.kind === 'conversation_snapshot')) {
        excerpt = await readFile(join(this.blobRoot, item.payloadRef.slice('blob:'.length)))
          .then((bytes) => bytes.subarray(0, 2_400).toString('utf8').replace(/\s+/g, ' ').trim())
          .catch(() => '')
      }
      return {
        id: item.id,
        title: titleFor(item),
        kind: item.kind,
        sourceUrl: String((item.source as { url?: string }).url ?? ''),
        sourcePath: item.payloadRef.startsWith('blob:') || /^https?:\/\//i.test(item.payloadRef) ? '' : item.payloadRef,
        ...(excerpt ? { excerpt } : {}),
        suggestedProjects: item.suggestedProjects.slice(0, 3),
      }
    }))
    const generated = await this.intelligence.generateStructured('utility', {
      schemaName: 'lcos_capture_space_organize_v1',
      schema: ORGANIZE_SCHEMA,
      system: [
        'You organize a temporary capture canvas before materials enter any project.',
        'Group items by useful theme or likely project affinity. Keep group names short and human-readable.',
        'Do not invent project membership. projectHintId is only a hint and may be omitted.',
        'Do not delete or transform items. Return JSON only.',
      ].join(' '),
      input: { projects, captures: modelInput },
      timeoutMs: 7_000,
    }).catch(() => undefined)

    let groups: Array<{ label: string; captureIds: string[]; projectHintId?: string }> = []
    if (generated) {
      const raw = Array.isArray(generated.value.groups) ? generated.value.groups : []
      const validIds = new Set(items.map((item) => item.id))
      groups = raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const value = entry as { label?: unknown; captureIds?: unknown; projectHintId?: unknown }
        if (typeof value.label !== 'string' || !Array.isArray(value.captureIds)) return []
        const captureIds = value.captureIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
        if (!captureIds.length) return []
        return [{ label: value.label.trim().slice(0, 48) || '未分类', captureIds, ...(typeof value.projectHintId === 'string' ? { projectHintId: value.projectHintId } : {}) }]
      })
    }
    if (!groups.length) {
      const grouped = new Map<string, { label: string; captureIds: string[]; projectHintId?: string }>()
      for (const item of items) {
        const suggested = item.suggestedProjects[0]
        const project = suggested && suggested.score >= .6 ? projects.find((candidate) => candidate.id === suggested.projectId) : undefined
        const key = project ? `project:${project.id}` : `kind:${kindGroup(item)}`
        const current = grouped.get(key) ?? { label: project?.label ?? kindGroup(item), captureIds: [], ...(project ? { projectHintId: project.id } : {}) }
        current.captureIds.push(item.id)
        grouped.set(key, current)
      }
      groups = [...grouped.values()]
    }

    const current = this.metadata.getCaptureSpacePresentation()
    const laidOut = layoutGroups(groups, items, current.version + 1)
    const presentation = this.metadata.saveCaptureSpacePresentation({ schemaVersion: 1, views: laidOut.views, regions: laidOut.regions }, current.version)
    return {
      schemaVersion: 1,
      presentation,
      usedModel: Boolean(generated),
      ...(generated?.providerId ? { providerId: generated.providerId } : {}),
      ...(generated?.model ? { model: generated.model } : {}),
      summary: generated ? `已按内容与项目线索整理 ${items.length} 项材料。` : `本地模型暂不可用，已按已有项目线索和材料类型整理 ${items.length} 项。`,
    }
  }

  async materializeToProject(captureIds: readonly string[], projectId: string): Promise<CaptureMaterializeResultV1> {
    if (!captureIds.length) throw new Error('At least one capture id is required.')
    const project = this.metadata.getProject(projectId)
    if (!project) throw new Error('Project not found.')
    const scopes = this.metadata.getScopes(projectId)
    const rootScope = scopes.find((scope) => scope.kind === 'root')
    if (!rootScope) throw new Error('Project has no root scope.')
    const scopeId = String(rootScope.id)
    const items = captureIds.map((id) => this.metadata.getCaptureStagingItem(id))
    if (items.some((item) => item === undefined)) throw new Error('One or more capture ids do not exist.')
    // F6 follow-up（20260828 补充冻结）：同 project 已 resolved 且带产物回链 → 幂等复用，
    // 使 capture→surface 的 apply 两步链失败后可安全重试（不重复物化）。
    // resolved 到其它 project、或存量行缺回链 → 维持 fail-close，不猜产物。
    const reused: CaptureMaterializeResultV1['items'][number][] = []
    const pending: CaptureStagingItemV0[] = []
    for (const item of items as CaptureStagingItemV0[]) {
      if (item.resolvedProjectId === undefined) { pending.push(item); continue }
      if (item.resolvedProjectId !== projectId || item.resolvedArtifactId === undefined || item.resolvedViewId === undefined) {
        throw new Error('One or more capture items were already resolved.')
      }
      reused.push({ captureId: item.id, artifactId: item.resolvedArtifactId, viewId: item.resolvedViewId, reused: true })
    }
    if (pending.length === 0) {
      return { schemaVersion: 1, projectId, batchId: '', imported: 0, items: reused }
    }

    const imported: CaptureMaterializeResultV1['items'][number][] = []
    for (const item of pending) {
      const position = this.placement.place({ projectId, scopeId })
      const materialized = await this.#importItem(projectId, scopeId, item, position)
      imported.push(materialized)
      this.staging.resolve(item.id, projectId, materialized.artifactId, materialized.viewId)
    }
    const now = new Date().toISOString()
    const batchId = `import-batch-capture-space-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    this.metadata.saveImportBatch({
      schemaVersion: 1,
      id: batchId,
      projectId,
      sourceKind: 'capture',
      status: 'completed',
      scopeId,
      importRequestIds: pending.map((item) => item.operationId),
      artifactIds: imported.map((item) => item.artifactId),
      revisionIds: imported.flatMap((item) => item.revisionId ? [item.revisionId] : []),
      viewIds: imported.map((item) => item.viewId),
      createdAt: now,
      completedAt: now,
    })
    const current = this.metadata.getCaptureSpacePresentation()
    const moved = new Set(captureIds)
    this.metadata.saveCaptureSpacePresentation({
      schemaVersion: 1,
      views: current.views.filter((view) => !moved.has(view.captureId)),
      regions: current.regions.map((region) => ({ ...region, captureIds: region.captureIds.filter((id) => !moved.has(id)) })).filter((region) => region.captureIds.length > 0),
    }, current.version)
    return { schemaVersion: 1, projectId, batchId, imported: imported.length, items: [...imported, ...reused] }
  }

  async #importItem(projectId: string, scopeId: string, item: CaptureStagingItemV0, position: { readonly x: number; readonly y: number }): Promise<CaptureMaterializeResultV1['items'][number]> {
    const ref = item.payloadRef
    const title = titleFor(item)
    if (/^https?:\/\//i.test(ref)) {
      const imported = await this.resources.importUrl(projectId as never, {
        importRequestId: item.operationId,
        url: ref,
        title,
        scopeId: scopeId as never,
        position,
      })
      return { captureId: item.id, artifactId: String(imported.artifactId), viewId: String(imported.viewId), revisionId: String(imported.revisionId), resourceId: String(imported.resourceId) }
    }
    if (ref.startsWith('blob:')) {
      const bytes = await readFile(join(this.blobRoot, ref.slice('blob:'.length)))
      const textLike = item.kind === 'clipboard_text' || item.kind === 'web_selection' || item.kind === 'conversation_snapshot'
      if (textLike) {
        const created = await createTextArtifact(this.metadata, projectId as never, { title, body: bytes.toString('utf8'), scopeId: scopeId as never, x: position.x, y: position.y })
        return { captureId: item.id, artifactId: created.artifactId, viewId: created.viewId, revisionId: created.revisionId }
      }
      const imported = await this.resources.importFile(projectId as never, {
        importRequestId: item.operationId,
        fileName: `${item.kind}-${ref.slice(5, 13)}.png`,
        contentType: 'image/png',
        bytes,
        scopeId: scopeId as never,
        position,
      })
      return { captureId: item.id, artifactId: String(imported.artifactId), viewId: String(imported.viewId), revisionId: String(imported.revisionId), resourceId: String(imported.resourceId) }
    }
    const bytes = await readFile(ref)
    const imported = await this.resources.importFile(projectId as never, {
      importRequestId: item.operationId,
      fileName: ref.split(/[\\/]/).at(-1) ?? 'capture.bin',
      contentType: 'application/octet-stream',
      bytes,
      scopeId: scopeId as never,
      position,
    })
    return { captureId: item.id, artifactId: String(imported.artifactId), viewId: String(imported.viewId), revisionId: String(imported.revisionId), resourceId: String(imported.resourceId) }
  }
}
