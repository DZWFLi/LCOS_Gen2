import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectSearchService } from '../src/project-search-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-search-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-search-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-02T09:00:00.000Z')
  repository.save(snapshot)
  return { repository, projectId: String(snapshot.project.id) }
}

describe('ProjectSearchService (Phase D)', () => {
  it('ranks exact artifact titles above text matches', async () => {
    const { repository, projectId } = setup()
    const service = new ProjectSearchService(repository, undefined)
    const result = await service.search(projectId, 'Brief')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]?.source).toBe('artifact-title')
    expect(result.hits[0]?.score).toBe(100)
  })

  it('finds artifact text content with snippets', async () => {
    const { repository, projectId } = setup()
    const service = new ProjectSearchService(repository, undefined)
    const result = await service.search(projectId, 'PortaSplit demo script')
    const textHit = result.hits.find((hit) => hit.source === 'artifact-text')
    expect(textHit).toBeDefined()
    expect(textHit?.snippet).toContain('PortaSplit demo script')
  })

  it('finds notes and respects type filters', async () => {
    const { repository, projectId } = setup()
    const service = new ProjectSearchService(repository, undefined)
    const result = await service.search(projectId, 'Feedback', { types: ['note'] })
    expect(result.hits.every((hit) => hit.entityType === 'note')).toBe(true)
    expect(result.hits.length).toBeGreaterThan(0)
  })
})
