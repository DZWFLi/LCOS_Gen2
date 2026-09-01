import type {
  ManifestResourceRefV0,
  ResourceDescriptorV0,
  ResourceMatchQueryV0,
  ResourceMatchV0,
} from '@local-creative-os/contracts'
import { resourceDescriptorHash } from './resource-descriptor-service.js'

const DEFAULT_LIMIT = 8
const MAX_SKILL_CANDIDATES = 3

export interface ResourceMatchOptions {
  readonly excludedResourceIds?: readonly string[]
  readonly pinnedResourceIds?: readonly string[]
  readonly activeContextArtifactIds?: readonly string[]
  readonly policyByResourceId?: ReadonlyMap<string, { readonly approvedContext: boolean; readonly executable: boolean }>
}

export class ResourceMatcher {
  match(
    descriptors: readonly ResourceDescriptorV0[],
    query: ResourceMatchQueryV0,
    options: ResourceMatchOptions = {},
  ): ResourceMatchV0[] {
    const tokens = tokenize(query.instruction)
    const excluded = new Set(options.excludedResourceIds ?? [])
    const pinned = new Set(options.pinnedResourceIds ?? [])
    const activeArtifacts = new Set(options.activeContextArtifactIds ?? [])
    const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT))
    const mediaTypes = query.mediaTypes === undefined ? undefined : new Set(query.mediaTypes)

    const scored: Array<{ match: ResourceMatchV0; descriptor: ResourceDescriptorV0 }> = []
    for (const descriptor of descriptors) {
      if (excluded.has(descriptor.resourceId)) continue
      if (mediaTypes !== undefined && descriptor.source.mediaType !== undefined && !mediaTypes.has(descriptor.source.mediaType)) continue
      const role = roleFor(descriptor)
      const capabilityScore = scoreCapabilities(descriptor, tokens)
      const kindScore = scoreKinds(descriptor, tokens)
      const inputScore = overlap(descriptor.inputs, tokens)
      const outputScore = overlap(descriptor.outputs, tokens)
      const activeContextScore = activeArtifacts.has(descriptor.artifactId) ? 1 : 0
      const userPinScore = pinned.has(descriptor.resourceId) ? 1 : 0
      const total = capabilityScore * 0.35
        + kindScore * 0.20
        + inputScore * 0.15
        + outputScore * 0.15
        + activeContextScore * 0.10
        + userPinScore * 0.05
      if (total <= 0) continue
      const requiresApproval = role === 'candidate_skill'
        && (descriptor.trust.level !== 'trusted' || descriptor.entrypoints.some((entry) => entry.kind === 'command'))
      const policy = options.policyByResourceId?.get(descriptor.resourceId)
      const layer = policy?.executable === true ? 'executable' : policy?.approvedContext === true ? 'approved' : 'suggested'
      const warnings: string[] = []
      if (requiresApproval) warnings.push('未授权 Skill：需要用户批准后才能作为执行候选。')
      if (descriptor.trust.executable) warnings.push('该资源包含可执行入口，默认不执行。')
      scored.push({
        match: {
          resourceId: descriptor.resourceId,
          artifactId: descriptor.artifactId,
          score: Number(total.toFixed(3)),
          role,
          reasons: buildReasons(descriptor, tokens),
          warnings,
          requiresApproval,
          layer,
        },
        descriptor,
      })
    }

    scored.sort((a, b) => b.match.score - a.match.score
      || a.match.resourceId.localeCompare(b.match.resourceId)
      || a.match.artifactId.localeCompare(b.match.artifactId))
    const result: ResourceMatchV0[] = []
    let skillCandidates = 0
    for (const entry of scored) {
      if (entry.match.role === 'candidate_skill') {
        if (skillCandidates >= MAX_SKILL_CANDIDATES) continue
        skillCandidates += 1
      }
      result.push(entry.match)
      if (result.length >= limit) break
    }
    return result
  }

  toManifestRefs(
    matches: readonly ResourceMatchV0[],
    descriptors: readonly ResourceDescriptorV0[],
  ): ManifestResourceRefV0[] {
    const byResource = new Map(descriptors.map((descriptor) => [descriptor.resourceId, descriptor]))
    const refs: ManifestResourceRefV0[] = []
    for (const match of matches) {
      const descriptor = byResource.get(match.resourceId)
      if (descriptor === undefined) continue
      refs.push({
        resourceId: match.resourceId,
        artifactId: match.artifactId,
        sourceRevisionId: descriptor.sourceRevisionId,
        descriptorHash: resourceDescriptorHash(descriptor),
        role: match.role,
        matchReasons: match.reasons,
        requiresApproval: match.requiresApproval,
      })
    }
    return refs
  }
}

function roleFor(descriptor: ResourceDescriptorV0): ResourceMatchV0['role'] {
  const kinds = descriptor.detectedKinds.map((kind) => kind.kind)
  if (kinds.includes('skill_package') || kinds.includes('skill_document')) return 'candidate_skill'
  if (kinds.includes('tool_config') || kinds.includes('manifest')) return 'tool_config'
  return 'reference'
}

function scoreCapabilities(descriptor: ResourceDescriptorV0, tokens: Set<string>): number {
  let best = 0
  for (const capability of descriptor.capabilities) {
    const nameTokens = tokenize(capability.name)
    const hit = [...nameTokens].some((token) => tokens.has(token))
    if (hit && capability.confidence > best) best = capability.confidence
  }
  return best
}

function scoreKinds(descriptor: ResourceDescriptorV0, tokens: Set<string>): number {
  let best = 0
  for (const kind of descriptor.detectedKinds) {
    const kindTokens = tokenize(kind.kind)
    const hit = [...kindTokens].some((token) => tokens.has(token))
    if (hit && kind.confidence > best) best = kind.confidence
  }
  return best
}

function overlap(values: readonly string[], tokens: Set<string>): number {
  if (values.length === 0) return 0
  const valueTokens = new Set(values.flatMap((value) => [...tokenize(value)]))
  const hits = [...valueTokens].filter((token) => tokens.has(token)).length
  return hits === 0 ? 0 : Math.min(1, hits / Math.max(1, Math.min(valueTokens.size, 5)))
}

function buildReasons(descriptor: ResourceDescriptorV0, tokens: Set<string>): string[] {
  const reasons: string[] = []
  for (const capability of descriptor.capabilities.slice(0, 2)) {
    const hit = [...tokenize(capability.name)].some((token) => tokens.has(token))
    if (hit) reasons.push(`能力匹配：${capability.name}`)
  }
  for (const kind of descriptor.detectedKinds.slice(0, 2)) {
    const hit = [...tokenize(kind.kind)].some((token) => tokens.has(token))
    if (hit) reasons.push(`类型匹配：${kind.kind}`)
  }
  if (reasons.length === 0) reasons.push(`资源：${descriptor.display.title}`)
  return reasons
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
    const normalized = text.normalize('NFKC').toLocaleLowerCase('en-US')
  for (const match of normalized.matchAll(/[a-z0-9]+/g)) {
    const token = match[0]
    if (token.length >= 2) tokens.add(token)
  }
  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, '')
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    tokens.add(cjk.slice(index, index + 2))
  }
  for (const character of cjk) tokens.add(character)
  return tokens
}
