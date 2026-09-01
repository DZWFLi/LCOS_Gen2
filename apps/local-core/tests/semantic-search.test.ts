import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectSearchService } from '../src/project-search-service.js'
import { SemanticIndexService } from '../src/semantic-index-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-semantic-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-semantic-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-02T09:00:00.000Z')
  repository.save(snapshot)
  return { repository, projectId: String(snapshot.project.id) }
}

describe('Semantic index + search pipeline (Phase G)', () => {
  it('indexes derived documents and finds them via FTS without Ollama', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const indexed = await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: 'Curated Note',
      body: 'unique semantic phrase zebra catalyst for FTS verification',
    })
    expect(indexed.indexed).toBe(true)
    expect(indexed.vector).toBe(false) // Ollama unavailable → FTS-only

    const search = new ProjectSearchService(repository, undefined, semantic)
    const ftsDebug = repository.searchDocumentsFts(projectId, 'FileRecord identity', 10)
    console.log('FTS DEBUG:', JSON.stringify(ftsDebug))
    const result = await search.search(projectId, 'zebra catalyst')
    const docHit = result.hits.find((hit) => hit.source === 'search-document-fts')
    expect(docHit).toBeDefined()
    expect(docHit?.snippet).toContain('zebra catalyst')
  })

  it('skips re-indexing unchanged content', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const entity = { projectId, entityType: 'note', entityId: 'note-feedback-view', title: 'Note', body: 'same body' }
    await semantic.indexEntity(entity)
    const second = await semantic.indexEntity(entity)
    expect(second.indexed).toBe(false)
  })

  it('expands related neighbors with bounded budget', async () => {
    const { repository, projectId } = setup()
    const search = new ProjectSearchService(repository, undefined, undefined)
    const result = await search.search(projectId, 'Brief', { related: true, limit: 20 })
    const related = result.hits.filter((hit) => hit.source === 'related')
    expect(related.length).toBeLessThanOrEqual(10 * 5)
  })

  it('reports vector health without crashing when Ollama is down', async () => {
    const { repository } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const health = semantic.health()
    expect(['native', 'fallback']).toContain(health.vector)
    const vectors = await semantic.searchVectors('anything')
    expect(vectors).toEqual([])
  })
})
