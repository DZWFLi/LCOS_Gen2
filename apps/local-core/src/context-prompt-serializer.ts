import { createHash } from 'node:crypto'

import type {
  CompiledContextPromptV1,
  ContextCacheTelemetryV1,
  ContextManifestOrderedItemV0,
  ContextManifestV0,
} from '@local-creative-os/contracts'
import { CONTEXT_PROMPT_SERIALIZER_V1 } from '@local-creative-os/contracts'

export interface ContextPromptManifestSourceV1 {
  /** Schema v0 manifests persisted before project labels were added only contain id. */
  readonly project: Pick<ContextManifestV0['project'], 'id'> & Partial<Pick<ContextManifestV0['project'], 'name'>>
  readonly target?: ContextManifestV0['target']
  readonly orderedItems?: ContextManifestV0['orderedItems']
  readonly lockedElements?: ContextManifestV0['lockedElements']
  readonly resourceRefs?: ContextManifestV0['resourceRefs']
  readonly cachePlan?: ContextManifestV0['cachePlan']
}

export interface CompileContextPromptV1Input {
  readonly manifest: ContextPromptManifestSourceV1
  readonly userTask: string
  readonly outputIntent: 'create' | 'revise' | 'analyze'
  /** Current selection is attention, not Saved Context truth. */
  readonly selectionArtifactIds?: readonly string[]
  readonly runConstraints?: readonly string[]
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/g, '\n')
}

function scalar(value: string): string {
  return normalize(value).replace(/\n+/g, ' ').trim()
}

function estimateTokens(value: string): number {
  // Provider-neutral estimate only. Actual provider usage belongs in adapter telemetry.
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 4)
}

/** XML 属性值转义（huabu node-element.ts escapeXmlAttr 同构）：preview/label 是自由文本，不许破出属性。 */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, ' ').trim()
}

/**
 * `<selected_nodes>` 段（huabu selected-nodes.ts / node-element.ts 同构，20260827 P0 接线）：
 * 选中节点从裸 artifact-id 列表升级为 node-ref L1 扫描头（label/role/revision/preview），
 * Agent 先扫一眼再决定读全文。LCOS 化差异：
 * - huabu 的 file="nodes/<safeLabel>.md" 寻址在 LCOS 对应 /space/read（按 label 寻址），由 intro 指路；
 * - huabu 的 type（画布节点类型）对应 LCOS 的 role（manifest 语义角色）；
 * - huabu 的 rev token 对应 revisionId（写前 CAS 比对「读后是否被改」）。
 * focus id 未命中 manifest 项时渲染裸 `<node artifact />`（L0 引用，不伪造元数据）。
 */
function renderSelectedNodesSection(focus: readonly string[], manifest: ContextPromptManifestSourceV1): string {
  const byArtifact = new Map<string, ContextManifestOrderedItemV0>()
  for (const item of manifest.orderedItems ?? []) {
    if (item.artifactId === undefined) continue
    if (!byArtifact.has(item.artifactId)) byArtifact.set(item.artifactId, item)
  }
  const lines = [
    '<selected_nodes>',
    'Nodes the user selected for this task. Each <node> is metadata only: `preview` is a scan hint, not the full content. Read the full body via the space sandbox (POST /space/read, addressed by node label) or the artifact/revision ids with the curation tools; compare `revision` before writing to avoid stale overwrites.',
  ]
  for (const artifactId of focus) {
    const item = byArtifact.get(artifactId)
    if (item === undefined) {
      lines.push(`<node artifact="${escapeAttr(artifactId)}" />`)
      continue
    }
    const attrs = [
      `artifact="${escapeAttr(artifactId)}"`,
      `role="${escapeAttr(item.role)}"`,
      `label="${escapeAttr(item.title)}"`,
      item.revisionId === undefined ? '' : `revision="${escapeAttr(item.revisionId)}"`,
      item.preview === undefined ? '' : `preview="${escapeAttr(item.preview)}"`,
    ].filter(Boolean).join(' ')
    lines.push(`<node ${attrs} />`)
  }
  lines.push('</selected_nodes>')
  return lines.join('\n')
}

function renderItem(item: ContextManifestOrderedItemV0): string {
  const lines = [
    `<context-item role="${item.role}" identity="${scalar(item.identity)}">`,
    `title: ${scalar(item.title)}`,
  ]
  if (item.artifactId) lines.push(`artifact: ${scalar(item.artifactId)}`)
  if (item.revisionId) lines.push(`revision: ${scalar(item.revisionId)}`)
  if (item.mimeType) lines.push(`mime: ${scalar(item.mimeType)}`)
  if (item.sourceAnchor) lines.push(`anchor: ${scalar(item.sourceAnchor)}`)
  if (item.contentHash) lines.push(`content-hash: ${scalar(item.contentHash)}`)
  if (item.content !== undefined) lines.push('content:', normalize(item.content).trimEnd())
  lines.push('</context-item>')
  return lines.join('\n')
}

function stableItems(manifest: ContextPromptManifestSourceV1): readonly ContextManifestOrderedItemV0[] {
  const order = manifest.cachePlan?.stableItemIdentities ?? []
  if (order.length === 0) return []
  const byIdentity = new Map<string, ContextManifestOrderedItemV0>()
  for (const item of manifest.orderedItems ?? []) if (!byIdentity.has(item.identity)) byIdentity.set(item.identity, item)
  return order.flatMap((identity) => {
    const item = byIdentity.get(identity)
    return item === undefined ? [] : [item]
  })
}

function itemRevisionKey(item: ContextManifestOrderedItemV0): string | undefined {
  if (item.artifactId === undefined) return undefined
  return `${item.artifactId}@${item.revisionId ?? 'current'}`
}

function dynamicItems(manifest: ContextPromptManifestSourceV1): readonly ContextManifestOrderedItemV0[] {
  const stableIdentity = new Set(manifest.cachePlan?.stableItemIdentities ?? [])
  const stableRevisionKeys = new Set(stableItems(manifest).map(itemRevisionKey).filter((value): value is string => value !== undefined))
  return (manifest.orderedItems ?? []).filter((item) => {
    if (stableIdentity.has(item.identity)) return false
    const key = itemRevisionKey(item)
    return key === undefined || !stableRevisionKeys.has(key)
  })
}

export function compileContextPromptV1(input: CompileContextPromptV1Input): CompiledContextPromptV1 {
  const manifest = input.manifest
  const plan = manifest.cachePlan
  const stable = stableItems(manifest)
  const stableContextBody = stable.map(renderItem).join('\n\n')

  const stableSections = [
    '# LCOS Stable Context Prefix',
    `serializer: ${CONTEXT_PROMPT_SERIALIZER_V1}`,
    ...(plan?.routeId ? [`route: ${scalar(plan.routeId)}`] : []),
    ...(plan?.skillId ? [`skill: ${plan.skillId}${plan.skillVersion ? `@${scalar(plan.skillVersion)}` : ''}`] : []),
    ...(plan?.capabilityProfileId ? [`capability-profile: ${scalar(plan.capabilityProfileId)}`] : []),
    '',
    '## Project Baseline',
    `project-id: ${scalar(manifest.project.id)}`,
    `project-name: ${scalar(manifest.project.name ?? manifest.project.id)}`,
    '',
    '## Saved Context Snapshot',
    `saved-context-id: ${scalar(plan?.savedContextId ?? 'none')}`,
    stableContextBody || '(no saved-context members)',
  ]
  const stablePrefix = `${normalize(stableSections.join('\n')).trim()}\n`
  const stablePrefixHash = sha256(stablePrefix)
  const snapshotHash = sha256(`${scalar(plan?.savedContextId ?? 'none')}\n${stableContextBody}`)
  const snapshotId = `context-snapshot-v1-${snapshotHash}`

  const focus = [...new Set(input.selectionArtifactIds ?? plan?.focusArtifactIds ?? [])]
  const dynamic = dynamicItems(manifest)
  const dynamicSections = [
    '# LCOS Dynamic Task Tail',
    `output-intent: ${input.outputIntent}`,
    ...(manifest.target === null || manifest.target === undefined ? [] : [`target-artifact: ${scalar(manifest.target.artifactId)}`, `target-revision: ${scalar(manifest.target.revisionId)}`]),
    ...(focus.length === 0 ? [] : ['', '## Current Focus', renderSelectedNodesSection(focus, manifest)]),
    ...(dynamic.length === 0 ? [] : ['', '## Context Delta / Active Items', dynamic.map(renderItem).join('\n\n')]),
    ...((manifest.lockedElements ?? []).length === 0 ? [] : ['', '## Current Locked Elements', ...(manifest.lockedElements ?? []).map((value) => `- ${normalize(value).trim()}`)]),
    ...(manifest.resourceRefs === undefined || manifest.resourceRefs.length === 0
      ? []
      : ['', '## Current Resource References', ...manifest.resourceRefs.map((ref) => `- ${scalar(ref.role)}:${scalar(ref.resourceId)}@${scalar(ref.sourceRevisionId)}`)]),
    ...(input.runConstraints === undefined || input.runConstraints.length === 0
      ? []
      : ['', '## Run Constraints', ...input.runConstraints.map((value) => `- ${normalize(value).trim()}`)]),
    '',
    '## User Task',
    normalize(input.userTask).trim(),
  ]
  const dynamicTail = `${normalize(dynamicSections.join('\n')).trim()}\n`
  const dynamicTailHash = sha256(dynamicTail)
  const cacheFamily = [
    'lcos',
    scalar(manifest.project.id),
    scalar(plan?.savedContextId ?? 'project'),
    CONTEXT_PROMPT_SERIALIZER_V1,
    scalar(plan?.routeId ?? 'runtime'),
    scalar(plan?.skillId ? `${plan.skillId}@${plan.skillVersion ?? 'unknown'}` : 'skill-neutral'),
    scalar(plan?.capabilityProfileId ?? 'capability-neutral'),
  ].join(':')

  return {
    schemaVersion: 1,
    serializerVersion: CONTEXT_PROMPT_SERIALIZER_V1,
    projectId: manifest.project.id,
    ...(plan?.savedContextId === undefined ? {} : { savedContextId: plan.savedContextId }),
    snapshotId,
    ...(plan?.routeId === undefined ? {} : { routeId: plan.routeId }),
    ...(plan?.skillId === undefined ? {} : { skillId: plan.skillId }),
    ...(plan?.skillVersion === undefined ? {} : { skillVersion: plan.skillVersion }),
    ...(plan?.capabilityProfileId === undefined ? {} : { capabilityProfileId: plan.capabilityProfileId }),
    stablePrefix,
    dynamicTail,
    stablePrefixHash,
    dynamicTailHash,
    stablePrefixChars: stablePrefix.length,
    dynamicTailChars: dynamicTail.length,
    stablePrefixTokensEstimated: estimateTokens(stablePrefix),
    dynamicTailTokensEstimated: estimateTokens(dynamicTail),
    cacheFamily,
  }
}

export function contextCacheTelemetryV1(compiled: CompiledContextPromptV1, provider?: string): ContextCacheTelemetryV1 {
  return {
    schemaVersion: 1,
    serializerVersion: compiled.serializerVersion,
    projectId: compiled.projectId,
    ...(compiled.savedContextId === undefined ? {} : { savedContextId: compiled.savedContextId }),
    snapshotId: compiled.snapshotId,
    ...(compiled.routeId === undefined ? {} : { routeId: compiled.routeId }),
    ...(compiled.skillId === undefined ? {} : { skillId: compiled.skillId }),
    stablePrefixHash: compiled.stablePrefixHash,
    stablePrefixChars: compiled.stablePrefixChars,
    dynamicTailChars: compiled.dynamicTailChars,
    estimatedStableTokens: compiled.stablePrefixTokensEstimated,
    estimatedTailTokens: compiled.dynamicTailTokensEstimated,
    cacheFamily: compiled.cacheFamily,
    ...(provider === undefined ? {} : { provider }),
  }
}
