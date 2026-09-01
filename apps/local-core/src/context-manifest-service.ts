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

const BUILDER_VERSION = '0.1.1'
const MAX_ITEM_CHARACTERS = 32_000
const MAX_TOTAL_CHARACTERS = 128_000
const TEXT_MIME_TYPES = new Set(['text/markdown', 'text/plain'])

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
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

async function readTextExcerpt(fileRecord: FileRecord): Promise<{ readonly content?: string; readonly truncated: boolean }> {
  if (!TEXT_MIME_TYPES.has(fileRecord.mimeType) || fileRecord.availability === 'missing' || fileRecord.availability === 'unreadable') {
    return { truncated: false }
  }
  const file = await open(fileRecord.observedPath, 'r')
  try {
    const buffer = Buffer.alloc(MAX_ITEM_CHARACTERS * 4 + 4)
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0)
    const value = buffer.subarray(0, bytesRead).toString('utf8')
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
    ): Promise<ContextManifestArtifactRefV0 | null> => {
      const revisionId = revisionOverrideId ?? (artifact.currentRevisionId === undefined ? undefined : String(artifact.currentRevisionId))
      if (revisionId === undefined) return null
      const revision = revisionById.get(revisionId)
      if (revision === undefined || String(revision.artifactId) !== String(artifact.id)) return null
      const fileRecord = fileRecordById.get(String(revision.fileRecordId))
      if (fileRecord === undefined) return null
      let excerpt: { readonly content?: string; readonly truncated: boolean } = { truncated: false }
      try {
        excerpt = await readTextExcerpt(fileRecord)
      } catch {
        excerpt = { content: '[unreadable]', truncated: false }
      }
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
    if (target) await appendArtifact(target, 'target')
    const references = (await Promise.all(referenceArtifacts.sort(byIdentity).map((artifact) => appendArtifact(artifact, 'reference'))))
      .filter((value): value is ContextManifestArtifactRefV0 => value !== null)
    for (const artifact of feedbackArtifacts.sort(byIdentity)) {
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
