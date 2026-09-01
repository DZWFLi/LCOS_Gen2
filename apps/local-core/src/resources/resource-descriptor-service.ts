import { createHash } from 'node:crypto'

import type {
  ResourceDescriptorId,
  ResourceDescriptorV0,
  ResourceId,
} from '@local-creative-os/contracts'

import { AnalyzerRegistry, type ResourceAnalysisInput } from './analyzers/analyzer-registry.js'

export const FAST_DESCRIPTOR_ANALYZER = 'fast-v0'
export const RESOURCE_ANALYZER_VERSION = 'resource-v1'

export function resourceDescriptorHash(descriptor: ResourceDescriptorV0): string {
  const semantic = {
    ...descriptor,
    understanding: {
      ...descriptor.understanding,
      analyzedAt: undefined,
    },
    userAnnotation: undefined,
  }
  return createHash('sha256').update(stableJson(semantic)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export interface FastDescriptorInput {
  readonly projectId: string
  readonly resourceId: ResourceId
  readonly artifactId: string
  readonly revisionId: string
  readonly title: string
  readonly sourceKind: ResourceDescriptorV0['source']['kind']
  readonly originalName?: string
  readonly mediaType?: string
  readonly extension?: string
  readonly normalizedUrl?: string
  readonly domain?: string
  readonly contentHash?: string
  readonly userNote?: string
}

export class ResourceDescriptorService {
  buildFastDescriptor(input: FastDescriptorInput): ResourceDescriptorV0 {
    const now = new Date().toISOString()
    const id = `descriptor-${createHash('sha256')
      .update(input.projectId).update('\0').update(input.resourceId).update('\0').update(FAST_DESCRIPTOR_ANALYZER)
      .digest('hex').slice(0, 24)}` as ResourceDescriptorId
    const displayTitle = input.title.trim() || input.originalName?.trim() || 'Imported resource'
    return {
      schemaVersion: '0',
      id,
      projectId: input.projectId,
      resourceId: input.resourceId,
      artifactId: input.artifactId,
      sourceRevisionId: input.revisionId,
      source: {
        kind: input.sourceKind,
        ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
        ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
        ...(input.extension === undefined ? {} : { extension: input.extension }),
        ...(input.normalizedUrl === undefined ? {} : { normalizedUrl: input.normalizedUrl }),
        ...(input.domain === undefined ? {} : { domain: input.domain }),
        ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
      },
      display: {
        title: displayTitle,
        ...(input.extension === undefined ? {} : { subtitle: input.extension }),
        ...(input.extension === undefined ? {} : { iconHint: input.extension.replace('.', '') }),
      },
      detectedKinds: [],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: {
        status: 'pending',
        warnings: [],
        analyzerVersion: FAST_DESCRIPTOR_ANALYZER,
      },
      trust: {
        level: 'untrusted',
        readable: true,
        executable: false,
        requiresApproval: false,
      },
    }
  }

  async analyzeResource(
    descriptor: ResourceDescriptorV0,
    content: string,
    registry: AnalyzerRegistry,
    signal?: AbortSignal,
    readFile?: (relativePath: string) => Promise<string | undefined>,
  ): Promise<ResourceDescriptorV0> {
    const now = new Date().toISOString()
    const input: ResourceAnalysisInput = {
      descriptor,
      content,
      ...(descriptor.source.contentHash === undefined ? {} : { contentHash: descriptor.source.contentHash }),
      ...(readFile === undefined ? {} : { readFile }),
      ...(signal === undefined ? {} : { signal }),
    }
    const draft = await registry.analyze(input, signal)
    return {
      ...descriptor,
      detectedKinds: draft.detectedKinds,
      capabilities: draft.capabilities,
      inputs: draft.inputs,
      outputs: draft.outputs,
      constraints: draft.constraints,
      entrypoints: draft.entrypoints,
      readFirst: draft.readFirst,
      understanding: {
        status: draft.understanding.status,
        ...(draft.understanding.summary === undefined ? {} : { summary: draft.understanding.summary }),
        warnings: draft.understanding.warnings,
        analyzerVersion: draft.understanding.analyzerVersion,
        ...{ analyzedAt: now },
      },
    }
  }
}
