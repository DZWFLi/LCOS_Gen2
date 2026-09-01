import { open } from 'node:fs/promises'

import type { CurationContentKindV0, CurationNodeV0, CurationReadBudgetV0, CurationReadResultV0 } from '@local-creative-os/contracts'
import type { Artifact, ProjectId } from '@local-creative-os/domain'

import type { ConversationImportService } from './conversation-import-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

const DEFAULT_BUDGET: Required<CurationReadBudgetV0> = { maxItems: 20, maxCharsPerItem: 8_000, maxTotalChars: 60_000 }
const HARD_BUDGET: Required<CurationReadBudgetV0> = { maxItems: 100, maxCharsPerItem: 30_000, maxTotalChars: 300_000 }
const TEXT_MIME = new Set(['text/markdown', 'text/plain'])

function normalizeBudget(input: CurationReadBudgetV0 | undefined): Required<CurationReadBudgetV0> {
  const clamp = (value: number | undefined, fallback: number, max: number): number => {
    if (value === undefined) return fallback
    return Math.max(1, Math.min(max, Math.floor(value)))
  }
  return {
    maxItems: clamp(input?.maxItems, DEFAULT_BUDGET.maxItems, HARD_BUDGET.maxItems),
    maxCharsPerItem: clamp(input?.maxCharsPerItem, DEFAULT_BUDGET.maxCharsPerItem, HARD_BUDGET.maxCharsPerItem),
    maxTotalChars: clamp(input?.maxTotalChars, DEFAULT_BUDGET.maxTotalChars, HARD_BUDGET.maxTotalChars),
  }
}

function contentKindFor(artifact: Artifact, mimeType: string | undefined): CurationContentKindV0 {
  if (artifact.kind === 'image') return 'image'
  if (artifact.kind === 'pdf') return 'pdf'
  if (artifact.kind === 'presentation') return 'presentation'
  if (artifact.kind === 'markdown') return 'markdown'
  if (mimeType === 'text/plain') return 'text'
  return 'other'
}

async function readTextPrefix(observedPath: string | undefined, maxChars: number): Promise<{ readonly text: string; readonly truncated: boolean }> {
  if (observedPath === undefined) return { text: '', truncated: false }
  try {
    const handle = await open(observedPath, 'r')
    try {
      const buffer = Buffer.alloc(maxChars * 4 + 4)
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      return { text: text.slice(0, maxChars), truncated: text.length > maxChars }
    } finally {
      await handle.close()
    }
  } catch {
    return { text: '', truncated: false }
  }
}

export interface CurationQueryServiceDeps {
  readonly repository: SqliteMetadataRepository
  readonly conversations?: ConversationImportService
}

/**
 * Phase D: Agent-facing bounded read over Views → Artifact → Current Revision
 * → content (text / resource hints / conversation marker). Never copies parser
 * logic; reuses repository + ResourceReader + Conversation service.
 */
export class CurationQueryService {
  constructor(private readonly deps: CurationQueryServiceDeps) {}

  async readViews(projectId: string, viewIds: readonly string[], budgetInput?: CurationReadBudgetV0): Promise<CurationReadResultV0> {
    const budget = normalizeBudget(budgetInput)
    const nodes: CurationNodeV0[] = []
    let totalChars = 0
    let truncated = false
    for (const viewId of viewIds) {
      if (nodes.length >= budget.maxItems) { truncated = true; break }
      const node = await this.#readView(projectId, viewId, budget.maxCharsPerItem)
      if (node === undefined) continue
      if (totalChars + node.boundedText.length > budget.maxTotalChars) { truncated = true; break }
      totalChars += node.boundedText.length
      nodes.push(node)
    }
    return {
      query: 'view-read',
      nodes,
      totalMatches: nodes.length,
      truncated,
      generatedAt: new Date().toISOString(),
      budget: { maxItems: budget.maxItems, maxCharsPerItem: budget.maxCharsPerItem, maxTotalChars: budget.maxTotalChars },
    }
  }

  async #readView(projectId: string, viewId: string, maxChars: number): Promise<CurationNodeV0 | undefined> {
    const { repository, conversations } = this.deps
    const view = repository.getArtifactView(viewId)
    if (view === undefined) return undefined
    const artifact = repository.getArtifact(String(view.artifactId))
    if (artifact === undefined || String(artifact.projectId) !== projectId) return undefined
    // Primary Views are live projections of Artifact truth and must follow the
    // Artifact current revision. Explicit additional Views may intentionally pin
    // a historical revision. Keep this aligned with the Web runtime projection.
    const revisionId = view.referenceKind === 'primary'
      ? artifact.currentRevisionId ?? view.revisionId
      : view.revisionId ?? artifact.currentRevisionId
    const revision = revisionId === undefined ? undefined : repository.getArtifactRevision(revisionId)
    const fileRecord = revision?.fileRecordId === undefined ? undefined : repository.getFileRecord(String(revision.fileRecordId))
    const mimeType = fileRecord?.mimeType ?? ''

    let contentKind = contentKindFor(artifact, mimeType)
    let boundedText = ''
    let truncated = false
    if (TEXT_MIME.has(mimeType)) {
      const read = await readTextPrefix(fileRecord?.observedPath, maxChars)
      boundedText = read.text
      truncated = read.truncated
    } else if (fileRecord === undefined) {
      boundedText = ''
    }

    // Conversation marker: view belongs to an imported conversation.
    if (conversations !== undefined) {
      const session = conversations.list(projectId).find((item) =>
        item.conversationViewId === viewId || item.conversationArtifactId === artifact.id)
      if (session !== undefined) {
        contentKind = 'conversation-section'
        if (boundedText === '') boundedText = `${session.title} · ${session.sectionCount} 章节 / ${session.messageCount} 条消息`
      }
    }

    const descriptor = repository.listResourceDescriptors(projectId)
      .find((item) => item.artifactId === artifact.id)
    const urlHint = descriptor?.source.kind === 'url'
      ? descriptor.source.normalizedUrl ?? descriptor.source.domain
      : /^https?:\/\//i.test(artifact.title)
        ? artifact.title
        : undefined
    return {
      stableRef: `artifact:${artifact.id}`,
      viewId,
      title: artifact.title,
      contentKind,
      boundedText,
      ...(fileRecord?.observedPath === undefined ? {} : { fileHints: [fileRecord.observedPath] }),
      ...(urlHint === undefined ? {} : { urlHints: [urlHint] }),
      ...(descriptor === undefined ? {} : { resourceHints: [String(descriptor.resourceId)] }),
      sourceRefs: [{
        kind: 'artifact',
        id: artifact.id,
        ...(revisionId === undefined ? {} : { revisionId }),
        ...(revision?.contentHash === undefined ? {} : { contentHash: revision.contentHash }),
      }],
      ...(revisionId === undefined ? {} : { currentRevisionId: revisionId }),
      ...(artifact.updatedAt === undefined ? {} : { updatedAt: artifact.updatedAt }),
      truncated,
    }
  }
}
