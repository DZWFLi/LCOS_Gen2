import type { ResourceDescriptorV0 } from '@local-creative-os/contracts'

export interface ResourceAnalysisInput {
  readonly descriptor: ResourceDescriptorV0
  readonly content: string
  readonly contentHash?: string
  readonly readFile?: (relativePath: string) => Promise<string | undefined>
  readonly signal?: AbortSignal
}

export interface ResourceDescriptorDraft {
  readonly detectedKinds: Array<{
    readonly kind: string
    readonly confidence: number
    readonly evidence: readonly {
      readonly source: 'filename' | 'content' | 'manifest' | 'structure' | 'metadata'
      readonly value: string
    }[]
  }>
  readonly capabilities: Array<{
    readonly name: string
    readonly confidence: number
    readonly evidence: readonly string[]
  }>
  readonly inputs: string[]
  readonly outputs: string[]
  readonly constraints: string[]
  readonly entrypoints: ResourceDescriptorV0['entrypoints']
  readonly readFirst: string[]
  readonly understanding: {
    readonly status: 'ready' | 'partial'
    readonly summary?: string
    readonly warnings: readonly string[]
    readonly analyzerVersion: string
  }
}

export interface ResourceAnalyzer {
  readonly id: string
  readonly version: string
  supports(input: ResourceAnalysisInput): number
  analyze(input: ResourceAnalysisInput, signal?: AbortSignal): Promise<ResourceDescriptorDraft>
}

export class AnalyzerRegistry {
  constructor(readonly analyzers: readonly ResourceAnalyzer[]) {}

  async analyze(input: ResourceAnalysisInput, signal?: AbortSignal): Promise<ResourceDescriptorDraft> {
    const supported = this.analyzers
      .map((analyzer) => ({ analyzer, score: analyzer.supports(input) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
    if (supported.length === 0) {
      throw new Error('No analyzer supports this resource.')
    }
    const primary = supported[0]!.analyzer
    const primaryDraft = await primary.analyze(input, signal)
    const merged = { ...primaryDraft }
    const mergedKinds = [...primaryDraft.detectedKinds]
    const mergedCapabilities = [...primaryDraft.capabilities]
    for (const { analyzer, score } of supported.slice(1)) {
      if (score < 0.3) continue
      const draft = await analyzer.analyze(input, signal)
      for (const kind of draft.detectedKinds) {
        if (!mergedKinds.some((existing) => existing.kind === kind.kind)) mergedKinds.push(kind)
      }
      for (const capability of draft.capabilities) {
        if (!mergedCapabilities.some((existing) => existing.name === capability.name)) mergedCapabilities.push(capability)
      }
    }
    return { ...merged, detectedKinds: mergedKinds, capabilities: mergedCapabilities }
  }
}
