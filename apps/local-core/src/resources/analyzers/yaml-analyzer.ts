import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

const MAX_DEPTH = 32

export class YamlAnalyzer implements ResourceAnalyzer {
  readonly id = 'yaml'
  readonly version = 'yaml-v0'

  supports(input: ResourceAnalysisInput): number {
    const extension = input.descriptor.source.extension?.toLocaleLowerCase('en-US') ?? ''
    const name = input.descriptor.source.originalName?.toLocaleLowerCase('en-US') ?? ''
    if (extension === '.yaml' || extension === '.yml' || name.endsWith('.yaml') || name.endsWith('.yml')) return 1
    return 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    let parsed: unknown
    try {
      parsed = parseYamlSubset(input.content)
    } catch (error: unknown) {
      return {
        detectedKinds: [{ kind: 'invalid_yaml', confidence: 0.9, evidence: [{ source: 'content', value: error instanceof Error ? error.message : 'YAML parse failed' }] }],
        capabilities: [],
        inputs: [],
        outputs: [],
        constraints: ['Not parseable by the safe YAML subset parser.'],
        entrypoints: [],
        readFirst: [],
        understanding: {
          status: 'partial',
          summary: '文件声明为 YAML 但无法安全解析（可能使用了别名/标签/复杂语法）。',
          warnings: [error instanceof Error ? error.message : 'unsafe or unsupported YAML'],
          analyzerVersion: this.version,
        },
      }
    }
    const shape = describeShape(parsed)
    const detectedKinds: ResourceDescriptorDraft['detectedKinds'] = []
    const has = (key: string): boolean => typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      && Object.prototype.hasOwnProperty.call(parsed, key)
    const stringField = (key: string): string | undefined => has(key) && typeof (parsed as Record<string, unknown>)[key] === 'string'
      ? String((parsed as Record<string, unknown>)[key])
      : undefined
    if (stringField('$schema') !== undefined || stringField('name') !== undefined) {
      detectedKinds.push({ kind: 'manifest', confidence: 0.75, evidence: [{ source: 'structure', value: '$schema/name present' }] })
    }
    if (has('tools') || has('steps') || has('nodes')) {
      detectedKinds.push({ kind: 'workflow_definition', confidence: 0.8, evidence: [{ source: 'structure', value: 'tools/steps/nodes present' }] })
    }
    if (detectedKinds.length === 0) {
      detectedKinds.push({ kind: 'structured_data', confidence: 0.6, evidence: [{ source: 'structure', value: shape }] })
    }
    return {
      detectedKinds,
      capabilities: detectedKinds.map((kind) => ({
        name: kind.kind,
        confidence: kind.confidence,
        evidence: kind.evidence.map((item) => item.value),
      })),
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: {
        status: 'ready',
        summary: `YAML 结构：${shape}`,
        warnings: [],
        analyzerVersion: this.version,
      },
    }
  }
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`
  if (typeof value !== 'object' || value === null) return typeof value
  const keys = Object.keys(value as Record<string, unknown>)
  return `object{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…' : ''}}`
}

function parseYamlSubset(text: string): unknown {
  const lines = text.split(/\r?\n/)
  const root = createNode('pending', null)
  const stack: Array<{ indent: number; node: YamlNode }> = [{ indent: -1, node: root }]
  let seenDocumentStart = false
  for (const raw of lines) {
    if (/^\s*$/.test(raw)) continue
    const line = stripComment(raw)
    if (/^\s*---\s*$/.test(line)) {
      if (!seenDocumentStart && stack.length === 1) {
        seenDocumentStart = true
        continue
      }
      throw new Error('Multiple YAML documents are not supported by the safe subset parser.')
    }
    if (/^\s*\.\.\.\s*$/.test(line)) continue
    if (/[&*!]/.test(line)) throw new Error('YAML anchors, aliases and tags are rejected.')
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      const popped = stack.pop()!
      if (popped.node.kind === 'pending') convertPending(popped.node, 'map')
    }
    const top = stack[stack.length - 1]!
    if (indent > top.indent && top.node.kind === 'pending') {
      convertPending(top.node, /^-\s*/.test(line.trimStart()) ? 'list' : 'map')
    }
    const parent = top.node
    if (parent.kind === 'pending') convertPending(parent, /^-\s*/.test(line.trimStart()) ? 'list' : 'map')
    const listMatch = /^-\s*(.*)$/.exec(line.trimStart())
    if (listMatch !== null) {
      if (parent.kind === 'map') throw new Error('List item cannot appear directly under a mapping without a key.')
      if (parent.kind === 'pending') convertPending(parent, 'list')
      const list = parent.kind === 'list' ? parent.list! : []
      const itemText = listMatch[1]!.trim()
      const itemKeyMatch = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(itemText)
      if (itemKeyMatch !== null) {
        const itemNode = createNode('map', parent, list)
        const itemValue = itemKeyMatch[2]!.trim()
        itemNode.map![itemKeyMatch[1]!] = itemValue === '' ? {} : parseScalar(itemValue)
        list.push(itemNode.map!)
        stack.push({ indent, node: itemNode })
        continue
      }
      const value = parseScalar(itemText)
      if (value === undefined) {
        const child = createNode('pending', parent, list)
        list.push(child)
        stack.push({ indent, node: child })
      } else {
        list.push(value)
      }
      continue
    }
    const keyMatch = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.trimStart())
    if (keyMatch === null) throw new Error(`Unsupported YAML line: ${line.trim().slice(0, 60)}`)
    if (parent.kind === 'list') throw new Error('Mapping entry cannot appear directly under a list.')
    if (parent.kind === 'pending') convertPending(parent, 'map')
    const map = parent.kind === 'map' ? parent.map! : {}
    const key = keyMatch[1]!
    const valueText = keyMatch[2]!.trim()
    if (valueText === '') {
      const child = createNode('pending', parent, undefined, key)
      map[key] = child
      stack.push({ indent, node: child })
    } else {
      map[key] = parseScalar(valueText)
    }
  }
  if (root.kind === 'pending') return {}
  finalizePending(root)
  if (root.kind === 'map') return root.map!
  return root.list!
}

function finalizePending(node: YamlNode): void {
  if (node.kind === 'map') {
    for (const key of Object.keys(node.map!)) {
      const value = node.map![key]
      if (isPendingNode(value)) {
        node.map![key] = {}
      }
    }
  } else if (node.kind === 'list') {
    node.list!.forEach((value, index) => {
      if (isPendingNode(value)) {
        node.list![index] = {}
      }
    })
  }
}

function isPendingNode(value: unknown): value is YamlNode {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'pending'
}

interface YamlNode {
  kind: 'pending' | 'map' | 'list'
  map?: Record<string, unknown>
  list?: unknown[]
  parent: YamlNode | null
  listIndex?: number
  key?: string
}

function createNode(
  kind: YamlNode['kind'],
  parent: YamlNode | null,
  list?: unknown[],
  key?: string,
): YamlNode {
  const node: YamlNode = {
    kind,
    parent,
    ...(list === undefined ? {} : { list }),
    ...(key === undefined ? {} : { key }),
  }
  if (kind === 'map') node.map = {}
  if (kind === 'list') node.list = list ?? []
  return node
}

function convertPending(node: YamlNode, kind: 'map' | 'list'): void {
  if (node.kind !== 'pending') return
  node.kind = kind
  if (kind === 'map') {
    node.map = {}
  } else {
    node.list = []
  }
  if (node.parent !== null) {
    if (node.parent.kind === 'map' && node.key !== undefined) {
      node.parent.map![node.key] = kind === 'map' ? node.map : node.list
    } else if (node.parent.kind === 'list') {
      const index = node.parent.list!.length - 1
      node.parent.list![index] = kind === 'map' ? node.map : node.list
    }
  }
}

function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === "'" && !inDouble) inSingle = !inSingle
    else if (char === '"' && !inSingle) inDouble = !inDouble
    else if (char === '#' && !inSingle && !inDouble && (index === 0 || line[index - 1] === ' ')) {
      return line.slice(0, index)
    }
  }
  return line
}

function parseScalar(value: string): unknown {
  if (value === '') return undefined
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1)
  if (value === 'true' || value === 'True') return true
  if (value === 'false' || value === 'False') return false
  if (value === 'null' || value === 'Null' || value === '~') return null
  const number = Number(value)
  if (value !== '' && Number.isFinite(number)) return number
  return value
}
