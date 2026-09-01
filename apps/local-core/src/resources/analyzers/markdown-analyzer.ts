import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'

const KEY_SECTIONS = new Set([
  'brief', 'objective', 'audience', 'background', 'goal',
  'scene', 'shot', 'vo', 'visual', 'script', 'storyboard',
  'change', 'keep', 'feedback', 'locked',
])

export class MarkdownAnalyzer implements ResourceAnalyzer {
  readonly id = 'markdown'
  readonly version = 'markdown-v0'

  supports(input: ResourceAnalysisInput): number {
    const extension = input.descriptor.source.extension?.toLocaleLowerCase('en-US') ?? ''
    const name = input.descriptor.source.originalName?.toLocaleLowerCase('en-US') ?? ''
    if (extension === '.md' || name.endsWith('.md')) return 1
    return 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    const lines = input.content.split(/\r?\n/)
    const frontmatter = new Map<string, string>()
    const headings: string[] = []
    const links: string[] = []
    const codeLanguages = new Set<string>()
    const contentLines: string[] = []

    let inFrontmatter = false
    let inCode = false
    let currentCodeLanguage = ''
    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!inFrontmatter && line === '---' && contentLines.length === 0) {
        inFrontmatter = true
        continue
      }
      if (inFrontmatter && line === '---') {
        inFrontmatter = false
        continue
      }
      if (inFrontmatter) {
        const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
        if (match !== null) frontmatter.set(match[1]!.toLocaleLowerCase('en-US'), match[2]!.trim())
        continue
      }
      if (!inCode && line.startsWith('```')) {
        inCode = true
        currentCodeLanguage = line.slice(3).trim().split(/\s+/)[0] ?? ''
        if (currentCodeLanguage !== '') codeLanguages.add(currentCodeLanguage)
        continue
      }
      if (inCode && line.startsWith('```')) {
        inCode = false
        continue
      }
      const heading = /^#{1,2}\s+(.+)$/.exec(line)
      if (heading !== null) headings.push(heading[1]!.trim())
      for (const match of line.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
        links.push(match[1]!)
      }
      contentLines.push(line)
    }

    const normalizedText = contentLines.join('\n').toLocaleLowerCase('en-US')
    const detectedKinds: ResourceDescriptorDraft['detectedKinds'] = []
    const evidence = (source: 'filename' | 'content', value: string) => [{ source, value }]
    const fileName = input.descriptor.source.originalName?.toLocaleLowerCase('en-US') ?? ''
    const skillHint = frontmatter.get('skill') ?? frontmatter.get('name')
    if (fileName === 'skill.md' || skillHint !== undefined || headings.some((h) => /skill|instruction|usage/i.test(h))) {
      detectedKinds.push({ kind: 'skill_document', confidence: 0.85, evidence: evidence('content', 'SKILL.md or skill frontmatter') })
    }
    if (/brief|objective|audience|background|goal/.test(normalizedText)) {
      detectedKinds.push({ kind: 'brief_candidate', confidence: 0.6, evidence: evidence('content', 'brief-like sections') })
    }
    if (/scene|shot|vo|storyboard/.test(normalizedText)) {
      detectedKinds.push({ kind: 'script_or_storyboard_candidate', confidence: 0.65, evidence: evidence('content', 'scene/shot/VO keywords') })
    }
    if (/change|keep|feedback|locked/.test(normalizedText)) {
      detectedKinds.push({ kind: 'feedback_candidate', confidence: 0.55, evidence: evidence('content', 'feedback keywords') })
    }
    if (detectedKinds.length === 0) {
      detectedKinds.push({ kind: 'markdown_document', confidence: 0.7, evidence: evidence('filename', '.md extension') })
    }

    const summary = contentLines.filter((line) => line.trim() !== '').slice(0, 3).join(' ').slice(0, 240)
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
      entrypoints: links.slice(0, 5).map((url) => ({ kind: 'url' as const, value: url })),
      readFirst: headings.slice(0, 3),
      understanding: {
        status: 'ready',
        summary: summary.length === 0 ? 'Markdown 文档已识别。' : `Markdown 结构：${summary}`,
        warnings: [],
        analyzerVersion: this.version,
      },
    }
  }
}
