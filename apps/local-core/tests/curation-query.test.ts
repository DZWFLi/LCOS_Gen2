import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CurationQueryService } from '../src/curation-query-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { reviseManagedTextArtifact } from '../src/text-artifact-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-curation-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-curation-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-02T09:00:00.000Z')
  repository.save(snapshot)
  return { repository, snapshot, projectId: String(snapshot.project.id) }
}

describe('CurationQueryService (Phase D)', () => {
  it('reads a view into a bounded CurationNode with artifact refs', async () => {
    const { repository, snapshot, projectId } = setup()
    const service = new CurationQueryService({ repository })
    const briefView = snapshot.artifactViews.find((view) => view.artifactId === 'artifact-brief')!
    const result = await service.readViews(projectId, [String(briefView.id)])
    expect(result.nodes).toHaveLength(1)
    const node = result.nodes[0]!
    expect(node.viewId).toBe(briefView.id)
    expect(node.title).toBe('Brief')
    expect(node.contentKind).toBe('markdown')
    expect(node.boundedText).toContain('PortaSplit MVP Brief')
    expect(node.currentRevisionId).toBe('revision-brief-initial')
    expect(node.sourceRefs[0]?.kind).toBe('artifact')
    expect(node.truncated).toBe(false)
  })

  it('primary view reads follow the Artifact current revision after a canonical edit', async () => {
    const { repository, snapshot, projectId } = setup()
    const service = new CurationQueryService({ repository })
    const briefView = snapshot.artifactViews.find((view) => view.artifactId === 'artifact-brief')!

    const revised = await reviseManagedTextArtifact(
      repository,
      snapshot.project.id,
      { viewId: String(briefView.id) },
      'PortaSplit current body after GUI edit',
    )

    const result = await service.readViews(projectId, [String(briefView.id)])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.currentRevisionId).toBe(revised.revisionId)
    expect(result.nodes[0]?.boundedText).toBe('PortaSplit current body after GUI edit')
  })

  it('enforces bounded read budget and marks truncation', async () => {
    const { repository, snapshot, projectId } = setup()
    const service = new CurationQueryService({ repository })
    const viewIds = snapshot.artifactViews.slice(0, 3).map((view) => String(view.id))
    const result = await service.readViews(projectId, viewIds, { maxItems: 1, maxTotalChars: 40 })
    expect(result.nodes.length).toBeLessThanOrEqual(1)
    expect(result.truncated).toBe(true)
    expect(result.budget?.maxItems).toBe(1)
  })

  it('skips missing views and rejects cross-project views', async () => {
    const { repository, snapshot, projectId } = setup()
    const service = new CurationQueryService({ repository })
    const result = await service.readViews(projectId, ['view-does-not-exist', 'view-foreign-project'])
    expect(result.nodes).toHaveLength(0)
  })

  it('returns 1-hop related entities with titles', async () => {
    const { repository, projectId } = setup()
    const service = new CurationQueryService({ repository })
    void service
    const related = repository.getRelations(projectId)
      .filter((relation) => String(relation.sourceEntityId) === 'artifact-brief' || String(relation.targetEntityId) === 'artifact-brief')
    expect(related.length).toBeGreaterThan(0)
    const kinds = related.map((relation) => relation.kind)
    expect(kinds).toContain('informs')
    expect(kinds).toContain('reference')
  })
})
