import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import {
  SemanticProviderRegistry,
  type EmbeddingProvider,
  type RetrievalProvider,
} from '../src/semantic-provider-registry.js'
import { SemanticIndexService } from '../src/semantic-index-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(): SqliteMetadataRepository {
  const root = mkdtempSync(join(tmpdir(), 'lcos-semantic-provider-'))
  roots.push(root)
  const repo = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repo)
  return repo
}

describe('S9 semantic provider registry', () => {
  it('injects fake embedding + retrieval providers without touching Ollama', async () => {
    const calls: string[] = []
    const embedding: EmbeddingProvider = {
      id: 'fake-embedding',
      async embed(request) {
        calls.push(`embed:${request.model}:${request.input.join('|')}`)
        return request.input.map(() => [0.25, 0.75])
      },
    }
    const retrieval: RetrievalProvider = {
      id: 'fake-retrieval',
      async retrieve(request) {
        calls.push(`retrieve:${request.model}:${request.limit}:${request.projectId ?? ''}:${request.vector.join(',')}`)
        return [{
          entityId: 'artifact-provider-hit',
          distance: 0.01,
          documentTitle: 'Provider Hit',
          chunkKind: 'body',
          chunkAnchor: 'section:provider',
          chunkIndex: 1,
          chunkCount: 2,
          chunkText: 'provider injection works',
        }]
      },
    }
    const providers = new SemanticProviderRegistry({
      embeddingProviders: [embedding],
      retrievalProviders: [retrieval],
      defaultEmbeddingProviderId: embedding.id,
      defaultRetrievalProviderId: retrieval.id,
    })
    const semantic = new SemanticIndexService(repository(), {
      providers,
      embeddingProviderId: embedding.id,
      retrievalProviderId: retrieval.id,
      vectorExtensionPath: '',
    })

    const hits = await semantic.searchVectors('needle', 'fake-model', 3, 'project-a')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.entityId).toBe('artifact-provider-hit')
    expect(calls).toEqual([
      'embed:fake-model:needle',
      'retrieve:fake-model:3:project-a:0.25,0.75',
    ])
    expect(semantic.providers().list().embedding).toEqual(['fake-embedding'])
    expect(semantic.providers().list().retrieval).toEqual(['fake-retrieval'])
    expect(semantic.health().embeddingProvider).toBe('fake-embedding')
    expect(semantic.health().retrievalProvider).toBe('fake-retrieval')
  })

  it('registers real text extractors but no fake visual embedding provider', () => {
    const semantic = new SemanticIndexService(repository(), { ollamaUrl: 'http://127.0.0.1:1', vectorExtensionPath: '' })
    const listed = semantic.providers().list()
    expect(listed.contentExtractors).toEqual(expect.arrayContaining([
      'plain-text', 'pdf-text-layer', 'ooxml-docx-pptx', 'image-ocr-evidence',
    ]))
    expect(listed.visualEmbedding).toEqual([])
  })
})
