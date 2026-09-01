import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

const PACKAGE_PROBE_FILES = ['SKILL.md', 'README.md', 'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod']

export class SkillPackageAnalyzer implements ResourceAnalyzer {
  readonly id = 'skill-package'
  readonly version = 'skill-package-v0'

  supports(input: ResourceAnalysisInput): number {
    if (input.descriptor.source.kind !== 'directory') return 0
    try {
      const manifest = JSON.parse(input.content) as { schemaVersion?: string; files?: readonly unknown[] }
      if (manifest.schemaVersion === '0' && Array.isArray(manifest.files)) return 1
    } catch {
      return 0
    }
    return 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    const manifest = JSON.parse(input.content) as {
      rootName?: string
      files?: readonly { path: string; size: number; contentHash: string }[]
    }
    const filePaths = new Set((manifest.files ?? []).map((file) => file.path))
    const has = (name: string): boolean => filePaths.has(name)
    const read = async (name: string): Promise<string | undefined> => {
      if (!has(name) || input.readFile === undefined) return undefined
      return input.readFile(name)
    }

    const skillMd = await read('SKILL.md')
    const readme = skillMd === undefined ? await read('README.md') : undefined
    const primary = skillMd ?? readme
    const name = extractFrontmatter(primary ?? '', 'name') ?? manifest.rootName ?? 'resource-package'
    const description = extractFrontmatter(primary ?? '', 'description')
      ?? extractFrontmatter(primary ?? '', 'summary')
      ?? primary?.split(/\r?\n/).find((line) => line.trim() !== '' && !line.startsWith('#'))?.trim().slice(0, 160)

    const entrypoints: Array<{ kind: 'file' | 'mcp' | 'url' | 'command'; value: string }> = []
    if (has('SKILL.md')) entrypoints.push({ kind: 'file', value: 'SKILL.md' })
    if (has('README.md')) entrypoints.push({ kind: 'file', value: 'README.md' })
    for (const file of manifest.files ?? []) {
      if (/^mcp[^/]*\.json$/i.test(file.path)) entrypoints.push({ kind: 'mcp', value: file.path })
      if (/^scripts\/[^/]+$/.test(file.path)) entrypoints.push({ kind: 'file', value: file.path })
    }

    const dependencies: string[] = []
    for (const dependencyFile of ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod']) {
      const content = await read(dependencyFile)
      if (content !== undefined) dependencies.push(dependencyFile)
    }
    const tools = (manifest.files ?? [])
      .filter((file) => /^mcp[^/]*\.json$/i.test(file.path))
      .map((file) => file.path)

    if (skillMd !== undefined) {
      return {
        detectedKinds: [{
          kind: 'skill_package',
          confidence: 0.9,
          evidence: [{ source: 'manifest', value: 'SKILL.md present' }],
        }],
        capabilities: [{
          name: 'skill_package',
          confidence: 0.9,
          evidence: ['SKILL.md found', ...tools.map((tool) => `mcp entry: ${tool}`)],
        }],
        inputs: extractList(primary ?? '', 'inputs'),
        outputs: extractList(primary ?? '', 'outputs'),
        constraints: ['Package is analyzed read-only; no dependency installation or execution is performed.'],
        entrypoints,
        readFirst: ['SKILL.md', ...(readme === undefined ? [] : ['README.md'])],
        understanding: {
          status: 'ready',
          summary: `Skill 包：${name}${description === undefined ? '' : ` — ${description}`}`,
          warnings: dependencies.length === 0 ? [] : [`声明依赖文件：${dependencies.join(', ')}（不安装、不执行）`],
          analyzerVersion: this.version,
        },
      }
    }

    return {
      detectedKinds: [{
        kind: 'unknown_package',
        confidence: 0.6,
        evidence: [{ source: 'manifest', value: 'no SKILL.md found' }],
      }],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: ['No SKILL.md found; contents are available read-only.'],
      entrypoints,
      readFirst: ['resource-manifest.json'],
      understanding: {
        status: 'partial',
        summary: `资源包已导入，但未找到 SKILL.md：${manifest.rootName ?? 'unknown'}`,
        warnings: ['SKILL.md 缺失，无法确认是标准 Skill 包。'],
        analyzerVersion: this.version,
      },
    }
  }
}

function extractFrontmatter(content: string, key: string): string | undefined {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.trim() === '---') return undefined
    const match = new RegExp(`^${key}:\\s*(.*)$`, 'i').exec(line)
    if (match !== null) return match[1]!.trim()
  }
  return undefined
}

function extractList(content: string, key: string): string[] {
  const section = new RegExp(`^\\s*${key}:\\s*$`, 'im')
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => section.test(line))
  if (start < 0) return []
  const result: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^\s*-?\s*$/.test(line)) continue
    if (!/^\s*-\s+/.test(line)) break
    result.push(line.replace(/^\s*-\s+/, '').trim())
    if (result.length >= 12) break
  }
  return result
}
