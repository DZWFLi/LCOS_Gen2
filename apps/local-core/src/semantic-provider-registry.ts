import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * S9: semantic retrieval provider seams.
 *
 * These interfaces deliberately live in Local Core rather than the GUI. Search stays one
 * product concept; provider choice is infrastructure and must not leak into normal surfaces.
 */

export interface EmbeddingRequestV1 {
  readonly model: string
  readonly input: readonly string[]
  readonly signal?: AbortSignal
}

export interface EmbeddingProvider {
  readonly id: string
  embed(request: EmbeddingRequestV1): Promise<number[][]>
}

export interface RetrievalRequestV1 {
  readonly model: string
  readonly vector: readonly number[]
  readonly limit: number
  readonly projectId?: string
}

export interface SemanticVectorHitV0 {
  readonly entityId: string
  readonly distance: number
  readonly documentTitle?: string
  readonly chunkKind: 'title' | 'body'
  readonly chunkAnchor?: string
  readonly chunkIndex?: number
  readonly chunkCount?: number
  readonly chunkText?: string
}

/** Vector-store / retrieval backend. It receives an already-produced embedding. */
export interface RetrievalProvider {
  readonly id: string
  retrieve(request: RetrievalRequestV1): Promise<SemanticVectorHitV0[]>
}

export interface ContentExtractionInputV1 {
  readonly mimeType: string
  readonly extension: string
  readonly observedPath: string
  readonly maxChars: number
  readonly projectId?: string
  readonly artifactId?: string
  readonly ocrEvidence?: (projectId: string, artifactId: string) => string | undefined
}

/**
 * Content extraction is textual evidence extraction for indexing. A provider must return an
 * empty string when it has no real evidence; filenames are never substituted for content.
 */
export interface ContentExtractor {
  readonly id: string
  supports(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): number
  extract(input: ContentExtractionInputV1): Promise<string>
}

export interface VisualEmbeddingRequestV1 {
  readonly model: string
  readonly observedPath: string
  readonly mimeType: string
  readonly signal?: AbortSignal
}

/**
 * Reserved real visual-embedding seam. S9 intentionally ships no fake implementation.
 * A provider may only be registered when it can produce a real visual embedding.
 */
export interface VisualEmbeddingProvider {
  readonly id: string
  supports(input: Pick<VisualEmbeddingRequestV1, 'mimeType' | 'observedPath'>): number
  embedVisual(request: VisualEmbeddingRequestV1): Promise<number[]>
}

export interface SemanticProviderRegistryOptions {
  readonly embeddingProviders?: readonly EmbeddingProvider[]
  readonly retrievalProviders?: readonly RetrievalProvider[]
  readonly contentExtractors?: readonly ContentExtractor[]
  readonly visualEmbeddingProviders?: readonly VisualEmbeddingProvider[]
  readonly defaultEmbeddingProviderId?: string
  readonly defaultRetrievalProviderId?: string
}

/** Small explicit registry; no global singleton and no provider guessing from UI state. */
export class SemanticProviderRegistry {
  readonly #embedding = new Map<string, EmbeddingProvider>()
  readonly #retrieval = new Map<string, RetrievalProvider>()
  readonly #content = new Map<string, ContentExtractor>()
  readonly #visual = new Map<string, VisualEmbeddingProvider>()
  #defaultEmbeddingProviderId: string | undefined
  #defaultRetrievalProviderId: string | undefined

  constructor(options: SemanticProviderRegistryOptions = {}) {
    for (const provider of options.embeddingProviders ?? []) this.registerEmbedding(provider)
    for (const provider of options.retrievalProviders ?? []) this.registerRetrieval(provider)
    for (const provider of options.contentExtractors ?? []) this.registerContentExtractor(provider)
    for (const provider of options.visualEmbeddingProviders ?? []) this.registerVisualEmbedding(provider)
    this.#defaultEmbeddingProviderId = options.defaultEmbeddingProviderId
    this.#defaultRetrievalProviderId = options.defaultRetrievalProviderId
  }

  registerEmbedding(provider: EmbeddingProvider): void {
    this.#assertUnique(this.#embedding, provider.id, 'embedding')
    this.#embedding.set(provider.id, provider)
    this.#defaultEmbeddingProviderId ??= provider.id
  }

  registerRetrieval(provider: RetrievalProvider): void {
    this.#assertUnique(this.#retrieval, provider.id, 'retrieval')
    this.#retrieval.set(provider.id, provider)
    this.#defaultRetrievalProviderId ??= provider.id
  }

  registerContentExtractor(provider: ContentExtractor): void {
    this.#assertUnique(this.#content, provider.id, 'content extractor')
    this.#content.set(provider.id, provider)
  }

  registerVisualEmbedding(provider: VisualEmbeddingProvider): void {
    this.#assertUnique(this.#visual, provider.id, 'visual embedding')
    this.#visual.set(provider.id, provider)
  }

  defaultEmbeddingProviderId(): string | undefined {
    return this.#defaultEmbeddingProviderId
  }

  defaultRetrievalProviderId(): string | undefined {
    return this.#defaultRetrievalProviderId
  }

  embedding(id = this.#defaultEmbeddingProviderId): EmbeddingProvider | undefined {
    return id === undefined ? undefined : this.#embedding.get(id)
  }

  retrieval(id = this.#defaultRetrievalProviderId): RetrievalProvider | undefined {
    return id === undefined ? undefined : this.#retrieval.get(id)
  }

  contentExtractor(id: string): ContentExtractor | undefined {
    return this.#content.get(id)
  }

  visualEmbedding(id: string): VisualEmbeddingProvider | undefined {
    return this.#visual.get(id)
  }

  resolveContentExtractor(input: Pick<ContentExtractionInputV1, 'mimeType' | 'extension'>): ContentExtractor | undefined {
    return [...this.#content.values()]
      .map((provider) => ({ provider, score: provider.supports(input) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.provider.id.localeCompare(right.provider.id))[0]?.provider
  }

  list(): {
    readonly embedding: readonly string[]
    readonly retrieval: readonly string[]
    readonly contentExtractors: readonly string[]
    readonly visualEmbedding: readonly string[]
  } {
    return {
      embedding: [...this.#embedding.keys()].sort(),
      retrieval: [...this.#retrieval.keys()].sort(),
      contentExtractors: [...this.#content.keys()].sort(),
      visualEmbedding: [...this.#visual.keys()].sort(),
    }
  }

  #assertUnique<T>(map: ReadonlyMap<string, T>, id: string, kind: string): void {
    if (id.trim() === '') throw new Error(`${kind} provider id is required.`)
    if (map.has(id)) throw new Error(`Duplicate ${kind} provider: ${id}`)
  }
}

export const OLLAMA_EMBEDDING_PROVIDER_ID = 'ollama-local'
export const LOCAL_CHUNK_RETRIEVAL_PROVIDER_ID = 'local-chunk-vector'

/** Default local embedding adapter; this is the old SemanticIndexService Ollama call, moved intact behind the seam. */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = OLLAMA_EMBEDDING_PROVIDER_ID

  constructor(private readonly ollamaUrl: string) {}

  async embed(request: EmbeddingRequestV1): Promise<number[][]> {
    const url = new URL('/api/embed', this.ollamaUrl)
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
      throw new Error('Ollama embedding endpoint must be loopback.')
    }
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    request.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model: request.model, input: request.input, truncate: true }),
      })
      if (!response.ok) throw new Error(`Ollama embed failed with HTTP ${response.status}.`)
      const value = await response.json() as { embeddings?: unknown }
      if (!Array.isArray(value.embeddings)
        || !value.embeddings.every((vector) => Array.isArray(vector) && vector.every((item) => typeof item === 'number'))) {
        throw new Error('Ollama returned an invalid embedding response.')
      }
      return value.embeddings as number[][]
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

/** Existing repository chunk KNN/blob fallback behind a RetrievalProvider seam. */
export class RepositoryChunkRetrievalProvider implements RetrievalProvider {
  readonly id = LOCAL_CHUNK_RETRIEVAL_PROVIDER_ID

  constructor(private readonly repository: SqliteMetadataRepository) {}

  async retrieve(request: RetrievalRequestV1): Promise<SemanticVectorHitV0[]> {
    return this.repository.querySearchChunkVectors(request.model, request.vector, request.limit, request.projectId)
  }
}
