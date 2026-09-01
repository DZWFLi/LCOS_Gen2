import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

export class TextAnalyzer implements ResourceAnalyzer {
  readonly id = 'text'
  readonly version = 'text-v0'

  supports(input: ResourceAnalysisInput): number {
    const extension = input.descriptor.source.extension?.toLocaleLowerCase('en-US') ?? ''
    if (extension === '.txt' || extension === '.text') return 1
    return 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    const lines = input.content.split(/\r?\n/)
    const firstNonEmpty = lines.find((line) => line.trim() !== '') ?? ''
    const preview = lines.filter((line) => line.trim() !== '').slice(0, 2).join(' ').trim().slice(0, 240)
    return {
      detectedKinds: [{
        kind: 'plain_text',
        confidence: 0.8,
        evidence: [{ source: 'filename', value: '.txt extension' }],
      }],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: firstNonEmpty === '' ? [] : [firstNonEmpty.slice(0, 120)],
      understanding: {
        status: 'ready',
        summary: preview === '' ? '纯文本文件，无内容预览。' : `文本预览：${preview}`,
        warnings: [],
        analyzerVersion: this.version,
      },
    }
  }
}
