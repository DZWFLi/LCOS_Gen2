import type {
  ResourceAnalyzer,
  ResourceAnalysisInput,
  ResourceDescriptorDraft,
} from './analyzer-registry.js'
import { assertSafeHttpUrl } from '../url-security.js'

const MAX_FETCH_BYTES = 256 * 1024
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 5_000

export class LinkAnalyzer implements ResourceAnalyzer {
  readonly id = 'link'
  readonly version = 'link-v0'

  supports(input: ResourceAnalysisInput): number {
    return input.descriptor.source.kind === 'url' ? 1 : 0
  }

  async analyze(input: ResourceAnalysisInput): Promise<ResourceDescriptorDraft> {
    const url = input.descriptor.source.normalizedUrl
    if (url === undefined) {
      return this.#partial('链接缺少 normalizedUrl。', ['missing normalizedUrl'])
    }
    try {
      const metadata = await fetchLinkMetadata(url, input.signal)
      const title = metadata.title ?? input.descriptor.display.title
      return {
        detectedKinds: [{
          kind: metadata.title === undefined ? 'web_link' : 'web_document',
          confidence: metadata.title === undefined ? 0.6 : 0.8,
          evidence: [
            { source: 'metadata', value: metadata.title ?? url },
          ],
        }],
        capabilities: [],
        inputs: [],
        outputs: [],
        constraints: [],
        entrypoints: [{ kind: 'url', value: url }],
        readFirst: [],
        understanding: {
          status: 'ready',
          summary: metadata.description !== undefined
            ? `链接标题：${title}；描述：${metadata.description.slice(0, 160)}`
            : `链接标题：${title}`,
          warnings: [],
          analyzerVersion: this.version,
        },
      }
    } catch (error: unknown) {
      return this.#partial(
        '链接已保存；元数据抓取失败，Agent 可按需通过连接器或内置浏览器读取。',
        [error instanceof Error ? error.message : 'fetch failed'],
      )
    }
  }

  #partial(summary: string, warnings: readonly string[]): ResourceDescriptorDraft {
    return {
      detectedKinds: [{ kind: 'web_link', confidence: 0.6, evidence: [{ source: 'metadata', value: 'fetch unavailable' }] }],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: {
        status: 'partial',
        summary,
        warnings,
        analyzerVersion: this.version,
      },
    }
  }
}

export async function fetchLinkMetadata(
  startUrl: string,
  signal?: AbortSignal,
): Promise<{ readonly title?: string; readonly description?: string }> {
  let current = startUrl
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const onOuterAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const safe = assertSafeHttpUrl(current)
      const response = await fetch(safe.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'lcos-resource-analyzer/0.1' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null) throw new Error('Redirect without Location header.')
        current = new URL(location, safe).href
        continue
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
        throw new Error(`Unsupported content type: ${contentType}`)
      }
      const bytes = new Uint8Array(MAX_FETCH_BYTES)
      let read = 0
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error('Response has no body.')
      while (read < MAX_FETCH_BYTES) {
        const chunk = await reader.read()
        if (chunk.done) break
        const slice = chunk.value.slice(0, MAX_FETCH_BYTES - read)
        bytes.set(slice, read)
        read += slice.byteLength
      }
      const text = Buffer.from(bytes.buffer, bytes.byteOffset, read).toString('utf8')
      const title = extractMeta(text, 'og:title') ?? extractTitle(text)
      const description = extractMeta(text, 'og:description') ?? extractMeta(text, 'description')
      return {
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
      }
    }
    throw new Error(`Too many redirects (${MAX_REDIRECTS}).`)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

function extractMeta(html: string, property: string): string | undefined {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i')
  const match = pattern.exec(html)
  if (match !== null) return decodeHtml(match[1]!)
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, 'i')
  const reversedMatch = reversed.exec(html)
  return reversedMatch === null ? undefined : decodeHtml(reversedMatch[1]!)
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  return match === null ? undefined : decodeHtml(match[1]!.trim())
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
