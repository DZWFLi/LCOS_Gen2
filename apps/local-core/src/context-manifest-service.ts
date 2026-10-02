import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

import { CONTEXT_PROMPT_SERIALIZER_V1 } from '@local-creative-os/contracts'
import type {
  BuildContextManifestV0Input,
  ContextManifestArtifactRefV0,
  ContextManifestFeedbackV0,
  ContextManifestOrderedItemV0,
  ContextManifestV0,
  ProjectGraphSnapshot,
} from '@local-creative-os/contracts'
import type {
  Artifact,
  ArtifactId,
  ArtifactRevision,
  ArtifactRevisionId,
  ContextManifestId,
  FileRecord,
  ProjectId,
} from '@local-creative-os/domain'

import { SqliteMetadataRepository } from './metadata-repository.js'
import { extractAgentNodePreview } from './node-ref.js'

const BUILDER_VERSION = '0.1.2'
const MAX_ITEM_CHARACTERS = 32_000
const MAX_TOTAL_CHARACTERS = 128_000
const TEXT_MIME_TYPES = new Set(['text/markdown', 'text/plain'])

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function byIdentity<Value extends { readonly id: unknown }>(left: Value, right: Value): number {
  return String(left.id).localeCompare(String(right.id), 'en-US')
}

function artifactRef(
  artifact: Artifact,
  revision: ArtifactRevision,
  fileRecord: FileRecord,
): ContextManifestArtifactRefV0 {
  return {
    artifactId: String(artifact.id),
    revisionId: String(revision.id),
    title: artifact.title,
    kind: artifact.kind,
    mimeType: fileRecord.mimeType,
    contentHash: String(revision.contentHash),
    availability: artifact.availability,
  }
}

async function readTextExcerpt(fileRecord: FileRecord, expectedRevisionHash?: string): Promise<{ readonly content?: string; readonly truncated: boolean }> {
  if (!TEXT_MIME_TYPES.has(fileRecord.mimeType) || fileRecord.availability === 'missing' || fileRecord.availability === 'unreadable') {
    return { truncated: false }
  }
  if (expectedRevisionHash !== undefined && String(fileRecord.observedHash) !== expectedRevisionHash) throw new Error('引用文件与已记录版本不一致。')
  const file = await open(fileRecord.observedPath, 'r')
  try {
    const buffer = Buffer.alloc(MAX_ITEM_CHARACTERS * 4 + 4)
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0)
    const bytes = buffer.subarray(0, bytesRead)
    const value = bytes.toString('utf8')
    if (expectedRevisionHash !== undefined) {
      // Reuse the existing Revision/FileRecord hash rule used by continuation.
      // Verify these exact read bytes before saving a manifest, not a second file read.
      if ((await file.stat()).size > bytesRead) return { content: value.slice(0, MAX_ITEM_CHARACTERS), truncated: true }
      if (hash(bytes) !== expectedRevisionHash) throw new Error('引用文件已在磁盘变化，不能冒充所选历史版本。')
    }
    if (value.length <= MAX_ITEM_CHARACTERS) return { content: value, truncated: false }
    return { content: value.slice(0, MAX_ITEM_CHARACTERS), truncated: true }
  } finally {
    await file.close()
  }
}

function extractLockedElements(values: readonly string[]): string[] {
  const results = new Set<string>()
  for (const value of values) {
    for (const line of value.split(/\r?\n/)) {
      const match = /^\s*(?:[-*]\s*)?(?:keep|locked|保留|锁定)(?:\s*[:：-]\s*|\s+)(.+)$/i.exec(line)
      if (match?.[1]) results.add(match[1].trim())
    }
  }
  return [...results].sort((left, right) => left.localeCompare(right, 'en-US'))
}

type CanonicalContextManifestV0 = Omit<
  ContextManifestV0,
  'id' | 'createdAt' | 'manifestHash' | 'renderedManifestHash' | 'renderedMarkdown'
>

function renderMarkdown(input: CanonicalContextManifestV0): string {
  const target = input.target
  const sections = [
    `# LCOS Context Manifest`,
    ``,
    `- Schema: v${input.schemaVersion}`,
    `- Builder: ${input.builderVersion}`,
    `- Project: ${input.project.name} (${input.project.id})`,
    `- Graph Version: ${input.project.graphVersion}`,
    `- Requested Output: ${input.requestedOutput}`,
    `- Target: ${target ? `${target.title} (${target.artifactId})` : 'None'}`,
    ``,
  ]
  for (const item of input.orderedItems) {
    sections.push(`## ${item.role.toUpperCase()} · ${item.title}`, ``, `Identity: ${item.identity}`)
    if (item.preview) sections.push(`Preview: ${item.preview}`)
    if (item.contentHash) sections.push(`Content Hash: ${item.contentHash}`)
    if (item.content) sections.push(``, item.content)
    sections.push(``)
  }
  if (input.lockedElements.length) {
    sections.push(`## LOCKED ELEMENTS`, ``, ...input.lockedElements.map((value) => `- ${value}`), ``)
  }
  if (input.truncationMetadata.truncatedItemIds.length) {
    sections.push(`## TRUNCATION`, ``, ...input.truncationMetadata.truncatedItemIds.map((value) => `- ${value}`), ``)
  }
  return `${sections.join('\n').trim()}\n`
}


export class ContextManifestService {
  constructor(readonly repository: SqliteMetadataRepository) {}

  async build(projectId: ProjectId, input: BuildContextManifestV0Input = {}): Promise<ContextManifestV0> {
    const graph = this.repository.get(String(projectId))
    if (graph === undefined) throw new Error('Project not found.')
    const artifactById = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const revisionById = new Map(graph.artifactRevisions.map((revision) => [String(revision.id), revision]))
    const fileRecordById = new Map(graph.fileRecords.map((record) => [String(record.id), record]))
    const target = this.#selectTarget(graph, input.targetArtifactId)
    const requestedTargetRevision = input.targetRevisionId === undefined
      ? undefined
      : revisionById.get(String(input.targetRevisionId))
    if (input.targetRevisionId !== undefined && requestedTargetRevision === undefined) {
      throw new Error(`Target Revision not found: ${input.targetRevisionId}`)
    }
    if (requestedTargetRevision !== undefined && String(requestedTargetRevision.artifactId) !== String(target?.id)) {
      throw new Error('Target Revision does not belong to the selected Artifact.')
    }
    const targetRevision = requestedTargetRevision
      ?? (target?.currentRevisionId === undefined ? undefined : revisionById.get(String(target.currentRevisionId)))
    const targetFile = targetRevision === undefined ? undefined : fileRecordById.get(String(targetRevision.fileRecordId))
    const targetRef = target && targetRevision && targetFile ? artifactRef(target, targetRevision, targetFile) : null

    // Resolve explicit references before the legacy implicit-context fallback. A reference
    // with a revision must not silently turn into the Artifact's current revision.
    const viewById = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
    const seenOrders = new Set<number>()
    const explicitReferences = [...(input.orderedReferences ?? [])].sort((a, b) => a.order - b.order).map((item) => {
      if (!Number.isSafeInteger(item.order) || item.order < 0 || seenOrders.has(item.order)) throw new Error('引用顺序无效或重复。')
      seenOrders.add(item.order)
      if (item.mode !== undefined && item.mode !== 'full') throw new Error('此任务暂只支持完整材料引用；摘要／结构引用请使用已支持的会话通道。')
      const ref = item.ref
      if (ref.type !== 'artifact' && ref.type !== 'view') throw new Error(`当前任务尚不支持 ${ref.type} 引用的内容展开；未创建任务，也未丢弃引用。`)
      const view = ref.type === 'view' ? viewById.get(ref.viewId) : undefined
      if (ref.type === 'view' && view === undefined) throw new Error(`引用视图已缺失：${ref.viewId}`)
      const id = ref.type === 'artifact' ? ref.artifactId : String(view!.artifactId)
      const artifact = artifactById.get(id)
      if (!artifact || String(artifact.projectId) !== String(projectId)) throw new Error(`引用材料已缺失或不属于当前项目：${id}`)
      const selectedRevision = ref.type === 'artifact' ? ref.revisionId : view?.revisionId
      const revisionId = selectedRevision === undefined ? artifact.currentRevisionId : selectedRevision
      const revision = revisionId === undefined ? undefined : revisionById.get(String(revisionId))
      if (!revision || String(revision.artifactId) !== id) throw new Error(`引用版本已缺失或不属于所选材料：${String(revisionId)}`)
      if (!fileRecordById.has(String(revision.fileRecordId))) throw new Error(`引用版本的文件已缺失：${String(revision.id)}`)
      return { artifact, revisionId: String(revision.id), order: item.order }
    })
    const explicitArtifactIds = new Set(explicitReferences.map((entry) => String(entry.artifact.id)))

    const related = [...graph.relations].sort(byIdentity)
    const referenceArtifacts = related
      .filter((relation) => relation.kind === 'reference' && relation.sourceEntityType === 'artifact')
      .map((relation) => artifactById.get(String(relation.sourceEntityId)))
      .filter((artifact): artifact is Artifact => artifact !== undefined)
    const feedbackArtifacts = related
      .filter((relation) => relation.kind === 'feedback' && relation.sourceEntityType === 'artifact')
      .map((relation) => artifactById.get(String(relation.sourceEntityId)))
      .filter((artifact): artifact is Artifact => artifact !== undefined)
    const explicitContextArtifacts = [...new Set(input.contextArtifactIds ?? [])]
      .filter((artifactId) => artifactId !== String(target?.id))
      .map((artifactId) => {
        const artifact = artifactById.get(artifactId)
        if (artifact === undefined) throw new Error(`Context Artifact not found: ${artifactId}`)
        return artifact
      })
    const targetScopeIds = new Set(
      graph.artifactViews
        .filter((view) => String(view.artifactId) === String(target?.id))
        .map((view) => String(view.scopeId)),
    )
    const scopeById = new Map(graph.scopes.map((scope) => [String(scope.id), scope]))
    const neighborhoodScopeIds = new Set(targetScopeIds)
    for (const scopeId of targetScopeIds) {
      const parentScopeId = scopeById.get(scopeId)?.parentScopeId
      if (parentScopeId === null || parentScopeId === undefined) continue
      neighborhoodScopeIds.add(String(parentScopeId))
      for (const scope of graph.scopes) {
        if (String(scope.parentScopeId) === String(parentScopeId)) neighborhoodScopeIds.add(String(scope.id))
      }
    }
    const siblingContextArtifacts = input.contextArtifactIds === undefined || input.contextArtifactIds.length === 0
      ? [...new Set(
          graph.artifactViews
            .filter((view) => neighborhoodScopeIds.has(String(view.scopeId)) && String(view.artifactId) !== String(target?.id))
            .map((view) => String(view.artifactId)),
        )]
          .map((artifactId) => artifactById.get(artifactId))
          .filter((artifact): artifact is Artifact => artifact !== undefined)
          .sort(byIdentity)
          .slice(0, 12)
      : []

    const truncatedItemIds: string[] = []
    const orderedItems: ContextManifestOrderedItemV0[] = []
    const feedback: ContextManifestFeedbackV0[] = []
    const lockedSource: string[] = []
    let remainingCharacters = MAX_TOTAL_CHARACTERS

    const appendArtifact = async (
      artifact: Artifact,
      role: ContextManifestOrderedItemV0['role'],
      revisionOverrideId?: string,
      identityOverride?: string,
      sourceAnchorOverride?: string,
      strictReference = false,
    ): Promise<ContextManifestArtifactRefV0 | null> => {
      const revisionId = revisionOverrideId ?? (artifact.currentRevisionId === undefined ? undefined : String(artifact.currentRevisionId))
      if (revisionId === undefined) return null
      const revision = revisionById.get(revisionId)
      if (revision === undefined || String(revision.artifactId) !== String(artifact.id)) return null
      const fileRecord = fileRecordById.get(String(revision.fileRecordId))
      if (fileRecord === undefined) return null
      let excerpt: { readonly content?: string; readonly truncated: boolean } = { truncated: false }
      try {
        excerpt = await readTextExcerpt(fileRecord, strictReference ? String(revision.contentHash) : undefined)
      } catch (error) {
        if (strictReference) throw new Error(`引用版本无法读取：${String(revision.id)}`, { cause: error })
        excerpt = { content: '[unreadable]', truncated: false }
      }
      if (strictReference && !excerpt.content?.trim()) throw new Error(`引用版本暂无可读取的文本：${String(revision.id)}；未创建任务。`)
      if (strictReference && (excerpt.truncated || (excerpt.content?.length ?? 0) > remainingCharacters)) throw new Error('本次引用超过任务文本额度；请减少材料，未自动截断已选择的版本。')
      if (excerpt.truncated) truncatedItemIds.push(String(artifact.id))
      if (excerpt.content) lockedSource.push(excerpt.content)
      const boundedContent = excerpt.content?.slice(0, Math.max(0, remainingCharacters))
      if (excerpt.content !== boundedContent) truncatedItemIds.push(String(artifact.id))
      remainingCharacters -= boundedContent?.length ?? 0
      const identity = identityOverride ?? String(artifact.id)
      // L1 扫描头（node-ref 借鉴）：折叠空白截 120 字，Agent 先扫一眼再决定读不读全文。
      const preview = extractAgentNodePreview(excerpt)
      orderedItems.push({
        role,
        identity,
        title: artifact.title,
        artifactId: String(artifact.id),
        revisionId: String(revision.id),
        mimeType: fileRecord.mimeType,
        ...(sourceAnchorOverride === undefined ? {} : { sourceAnchor: sourceAnchorOverride }),
        contentHash: String(revision.contentHash),
        ...(preview === undefined ? {} : { preview }),
        ...(boundedContent === undefined ? {} : { content: `<untrusted-context identity="${identity}">\n${boundedContent}\n</untrusted-context>` }),
      })
      return artifactRef(artifact, revision, fileRecord)
    }

    // Saved Context is compiled first so its bytes cannot depend on task-local target/reference
    // ordering or on how much dynamic material consumed the manifest character budget.
    const stableItemIdentities: string[] = []
    const stableArtifactIds = new Set<string>()
    for (const stable of input.stableContextItems ?? []) {
      const artifact = artifactById.get(String(stable.artifactId))
      if (artifact === undefined) throw new Error(`Saved Context Artifact not found: ${stable.artifactId}`)
      const requestedRevisionId = stable.revisionId
      if (requestedRevisionId !== undefined) {
        const requestedRevision = revisionById.get(String(requestedRevisionId))
        if (requestedRevision === undefined || String(requestedRevision.artifactId) !== String(artifact.id)) {
          throw new Error(`Saved Context Revision does not belong to Artifact: ${requestedRevisionId}`)
        }
      }
      const effectiveRevisionId = requestedRevisionId ?? (artifact.currentRevisionId === undefined ? undefined : String(artifact.currentRevisionId))
      if (effectiveRevisionId === undefined) continue
      // Stable Saved Context gets a dedicated identity. Never reuse target/reference/feedback
      // items because their task-local roles would make an unchanged Saved Context hash drift.
      const identity = `saved:${String(artifact.id)}:${effectiveRevisionId}${stable.sourceAnchor ? `:anchor-${hash(stable.sourceAnchor).slice(0, 16)}` : ''}`
      const appended = await appendArtifact(artifact, 'context', effectiveRevisionId, identity, stable.sourceAnchor)
      if (appended !== null) {
        stableItemIdentities.push(identity)
        stableArtifactIds.add(String(artifact.id))
      }
    }
    if (target) await appendArtifact(target, 'target', targetRevision === undefined ? undefined : String(targetRevision.id))
    const references: ContextManifestArtifactRefV0[] = []
    for (const item of explicitReferences) {
      const identity = `reference:${item.order}:${String(item.artifact.id)}:${item.revisionId}`
      const result = await appendArtifact(item.artifact, 'reference', item.revisionId, identity, undefined, true)
      if (result === null) throw new Error(`引用版本无法解析：${item.revisionId}`)
      references.push(result)
    }
    // appendArtifact updates the shared character budget and item order: run sequentially.
    // An explicit historical reference wins over an implicit current-version suggestion.
    for (const artifact of referenceArtifacts.sort(byIdentity)) {
      if (explicitArtifactIds.has(String(artifact.id))) continue
      const result = await appendArtifact(artifact, 'reference')
      if (result !== null) references.push(result)
    }
    for (const artifact of feedbackArtifacts.sort(byIdentity)) {
      if (explicitArtifactIds.has(String(artifact.id))) continue
      await appendArtifact(artifact, 'feedback')
      const item = orderedItems.at(-1)
      feedback.push({
        sourceArtifactId: String(artifact.id),
        title: artifact.title,
        body: item?.content ?? '',
        state: 'open',
      })
    }

    const alreadyIncluded = new Set([
      String(target?.id ?? ''),
      ...referenceArtifacts.map((artifact) => String(artifact.id)),
      ...feedbackArtifacts.map((artifact) => String(artifact.id)),
      ...stableArtifactIds,
      ...explicitArtifactIds,
    ])
    for (const artifact of explicitContextArtifacts) {
      if (alreadyIncluded.has(String(artifact.id))) continue
      await appendArtifact(artifact, 'context')
      alreadyIncluded.add(String(artifact.id))
    }
    for (const artifact of siblingContextArtifacts.sort(byIdentity)) {
      if (alreadyIncluded.has(String(artifact.id))) continue
      await appendArtifact(artifact, 'context')
      alreadyIncluded.add(String(artifact.id))
    }
    for (const note of [...graph.notes].sort(byIdentity)) {
      lockedSource.push(note.body)
      feedback.push({
        sourceNoteId: String(note.id),
        title: `Note ${String(note.id)}`,
        body: note.body,
        state: 'open',
      })
      orderedItems.push({ role: 'context', identity: String(note.id), title: `Note ${String(note.id)}`, content: note.body })
    }
    for (const checkpoint of [...graph.checkpoints].sort(byIdentity)) {
      orderedItems.push({
        role: 'decision',
        identity: String(checkpoint.id),
        title: checkpoint.label,
        content: JSON.stringify(checkpoint.snapshotJson),
      })
    }
    for (const extra of input.extraItems ?? []) {
      orderedItems.push({
        role: extra.role,
        identity: extra.identity,
        title: extra.title,
        ...(extra.content === undefined ? {} : { content: extra.content }),
        ...(extra.contentHash === undefined ? {} : { contentHash: extra.contentHash }),
      })
    }

    const base: CanonicalContextManifestV0 = {
      schemaVersion: 0,
      builderVersion: BUILDER_VERSION,
      project: {
        id: String(graph.project.id),
        name: graph.project.name,
        graphVersion: Number(graph.graphVersion),
      },
      target: targetRef,
      currentRevision: targetRef,
      feedback,
      lockedElements: extractLockedElements(lockedSource),
      references,
      requestedOutput: input.requestedOutput?.trim() || 'Markdown Script Revision',
      orderedItems,
      ...(input.resourceRefs !== undefined && input.resourceRefs.length > 0 ? { resourceRefs: input.resourceRefs } : {}),
      cachePlan: {
        schemaVersion: 1,
        serializerVersion: CONTEXT_PROMPT_SERIALIZER_V1,
        ...(input.savedContextId === undefined ? {} : { savedContextId: input.savedContextId }),
        stableItemIdentities,
        ...(input.contextArtifactIds === undefined || input.contextArtifactIds.length === 0 ? {} : { focusArtifactIds: [...new Set(input.contextArtifactIds)] }),
        ...(input.promptRouteId === undefined ? {} : { routeId: input.promptRouteId }),
        ...(input.promptSkillId === undefined ? {} : { skillId: input.promptSkillId }),
        ...(input.promptSkillVersion === undefined ? {} : { skillVersion: input.promptSkillVersion }),
        ...(input.capabilityProfileId === undefined ? {} : { capabilityProfileId: input.capabilityProfileId }),
      },
      truncationMetadata: {
        maxItemCharacters: MAX_ITEM_CHARACTERS,
        truncatedItemIds,
      },
    }
    const canonicalJson = JSON.stringify(base)
    const manifestHash = hash(canonicalJson)
    const manifestId = `context-manifest-${manifestHash}` as ContextManifestId
    const persisted = this.repository.createContextManifest({
      id: manifestId,
      projectId,
      schemaVersion: 0,
      ...(targetRef === null ? {} : {
        targetArtifactId: targetRef.artifactId as ArtifactId,
        targetRevisionId: targetRef.revisionId as ArtifactRevisionId,
      }),
      canonicalJson,
      manifestHash,
      createdAt: new Date().toISOString(),
    })
    const renderedMarkdown = renderMarkdown(base)
    return {
      id: persisted.id,
      createdAt: persisted.createdAt,
      manifestHash,
      ...base,
      renderedManifestHash: hash(renderedMarkdown),
      renderedMarkdown,
    }
  }

  #selectTarget(graph: ProjectGraphSnapshot, requestedId?: string): Artifact | undefined {
    if (requestedId) {
      const requested = graph.artifacts.find((artifact) => String(artifact.id) === requestedId)
      if (requested === undefined) throw new Error('Target Artifact not found.')
      return requested
    }
    return undefined
  }
}
