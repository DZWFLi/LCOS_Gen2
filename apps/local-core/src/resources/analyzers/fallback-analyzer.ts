import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

export class FallbackAnalyzer implements ResourceAnalyzer {
  readonly id = 'fallback'
  readonly version = 'fallback-v0'

  supports(): number {
    return 0.05
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    const preview = input.content.replace(/\s+/g, ' ').trim().slice(0, 240)
    const descriptor = input.descriptor
    return {
      detectedKinds: descriptor.detectedKinds.length > 0
        ? [...descriptor.detectedKinds]
        : [{
            kind: descriptor.source.kind === 'url' ? 'web_link' : 'unknown',
            confidence: 0.6,
            evidence: [{ source: 'filename' as const, value: descriptor.source.originalName ?? descriptor.source.normalizedUrl ?? 'unknown' }],
          }],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: {
        status: 'partial',
        summary: preview.length === 0
          ? '已导入；未识别出具体格式特征。'
          : `已导入；内容预览：${preview}`,
        warnings: ['未命中格式 Analyzer，使用 fallback 基础识别。'],
        analyzerVersion: this.version,
      },
    }
  }
}
