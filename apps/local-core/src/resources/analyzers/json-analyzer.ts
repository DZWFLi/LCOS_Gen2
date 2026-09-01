import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

export class JsonAnalyzer implements ResourceAnalyzer {
  readonly id = 'json'
  readonly version = 'json-v0'

  supports(input: ResourceAnalysisInput): number {
    const extension = input.descriptor.source.extension?.toLocaleLowerCase('en-US') ?? ''
    const name = input.descriptor.source.originalName?.toLocaleLowerCase('en-US') ?? ''
    if (extension === '.json' || name.endsWith('.json')) return 1
    if (input.content.trimStart().startsWith('{') || input.content.trimStart().startsWith('[')) return 0.5
    return 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.content)
    } catch {
      return {
        detectedKinds: [{ kind: 'invalid_json', confidence: 0.9, evidence: [{ source: 'content', value: 'JSON.parse failed' }] }],
        capabilities: [],
        inputs: [],
        outputs: [],
        constraints: ['Not valid JSON.'],
        entrypoints: [],
        readFirst: [],
        understanding: {
          status: 'partial',
          summary: '文件声明为 JSON 但解析失败。',
          warnings: ['JSON.parse failed; structure unknown.'],
          analyzerVersion: this.version,
        },
      }
    }
    const shape = describeJsonShape(parsed)
    const detectedKinds: ResourceDescriptorDraft['detectedKinds'] = []
    const has = (key: string): boolean => typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      && Object.prototype.hasOwnProperty.call(parsed, key)
    const stringField = (key: string): string | undefined => has(key) && typeof (parsed as Record<string, unknown>)[key] === 'string'
      ? String((parsed as Record<string, unknown>)[key])
      : undefined

    if (stringField('$schema') !== undefined || stringField('name') !== undefined) {
      detectedKinds.push({ kind: 'manifest', confidence: 0.75, evidence: [{ source: 'structure', value: '$schema/name present' }] })
    }
    if (stringField('name') !== undefined && (has('tools') || has('steps') || has('inputs') || has('outputs'))) {
      detectedKinds.push({ kind: 'skill_manifest', confidence: 0.8, evidence: [{ source: 'structure', value: 'name + tools/steps/inputs/outputs' }] })
    }
    if (has('nodes') && has('edges')) {
      detectedKinds.push({ kind: 'workflow_definition', confidence: 0.85, evidence: [{ source: 'structure', value: 'nodes + edges' }] })
    }
    if (has('tools') || stringField('type') === 'tool') {
      detectedKinds.push({ kind: 'tool_config', confidence: 0.7, evidence: [{ source: 'structure', value: 'tools/type field' }] })
    }
    if (detectedKinds.length === 0) {
      detectedKinds.push({ kind: 'structured_data', confidence: 0.6, evidence: [{ source: 'structure', value: shape.summary }] })
    }

    return {
      detectedKinds,
      capabilities: detectedKinds.map((kind) => ({
        name: kind.kind,
        confidence: kind.confidence,
        evidence: kind.evidence.map((item) => item.value),
      })),
      inputs: shape.inputs,
      outputs: shape.outputs,
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: {
        status: 'ready',
        summary: `JSON 结构：${shape.summary}`,
        warnings: [],
        analyzerVersion: this.version,
      },
    }
  }
}

function describeJsonShape(value: unknown): { summary: string; inputs: string[]; outputs: string[] } {
  if (Array.isArray(value)) {
    return { summary: `array[${value.length}]`, inputs: [], outputs: [] }
  }
  if (typeof value !== 'object' || value === null) {
    return { summary: typeof value, inputs: [], outputs: [] }
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  const inputs = Array.isArray(record.inputs) ? record.inputs.filter((item): item is string => typeof item === 'string') : []
  const outputs = Array.isArray(record.outputs) ? record.outputs.filter((item): item is string => typeof item === 'string') : []
  return {
    summary: `object{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…' : ''}}`,
    inputs,
    outputs,
  }
}
