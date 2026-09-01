import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-guard-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-guard-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-11T00:00:00.000Z')
  repository.save(snapshot)
  return { repository, projectId: String(snapshot.project.id) }
}

describe('HU-5 derived-write guard', () => {
  it('artifact: applied / deleted / stale / revision-missing', () => {
    const { repository, projectId } = setup()
    const revision = repository.getArtifactRevision('revision-brief-initial')!
    let committed = 0
    expect(repository.commitDerivedResult({
      entityType: 'artifact',
      entityId: 'artifact-brief',
      projectId,
      expectedRevisionId: revision.id,
      expectedContentHash: String(revision.contentHash),
    }, () => { committed += 1 })).toBe('applied')
    expect(committed).toBe(1)

    expect(repository.commitDerivedResult({
      entityType: 'artifact',
      entityId: 'artifact-missing',
      projectId,
    }, () => { committed += 1 })).toBe('skipped_deleted')
    expect(committed).toBe(1)

    expect(repository.commitDerivedResult({
      entityType: 'artifact',
      entityId: 'artifact-brief',
      projectId,
      expectedRevisionId: 'revision-missing',
    }, () => { committed += 1 })).toBe('skipped_deleted')
    expect(committed).toBe(1)

    expect(repository.commitDerivedResult({
      entityType: 'artifact',
      entityId: 'artifact-brief',
      projectId,
      expectedRevisionId: revision.id,
      expectedContentHash: 'stale-hash',
    }, () => { committed += 1 })).toBe('skipped_stale')
    expect(committed).toBe(1)
  })

  it('resource: applied / deleted（不因派生写入 resurrect 已删资源）', () => {
    const { repository, projectId } = setup()
    // mvp snapshot 无资源描述符：先建一个。
    repository.createResourceDescriptorPending({
      schemaVersion: '0',
      id: 'resource-guard-1',
      projectId,
      resourceId: 'resource-guard-1',
      artifactId: 'artifact-brief',
      sourceRevisionId: 'revision-brief-initial',
      source: { kind: 'url', normalizedUrl: 'https://example.com', domain: 'example.com', title: 'Guard' },
      display: { title: 'Guard', subtitle: '' },
      detectedKinds: [],
      capabilities: [],
      inputs: [],
      outputs: [],
      constraints: [],
      entrypoints: [],
      readFirst: [],
      understanding: { status: 'pending', warnings: [], analyzerVersion: 'test' },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    } as never)
    let committed = 0
    expect(repository.commitDerivedResult({
      entityType: 'resource',
      entityId: 'resource-guard-1',
      projectId,
    }, () => { committed += 1 })).toBe('applied')
    expect(committed).toBe(1)
    expect(repository.commitDerivedResult({
      entityType: 'resource',
      entityId: 'resource-gone',
      projectId,
    }, () => { committed += 1 })).toBe('skipped_deleted')
    expect(committed).toBe(1)
  })

  it('search-document embedding: applied / stale（内容已变）/ deleted', () => {
    const { repository, projectId } = setup()
    const embedding = {
      entityId: 'doc-guard',
      model: 'nomic-embed-text',
      dimensions: 4,
      contentHash: 'hash-v1',
      embeddingBlob: Buffer.from(new Float32Array([1, 2, 3, 4]).buffer),
      indexedAt: '2026-08-11T00:00:00.000Z',
    }
    expect(repository.commitSearchDocumentEmbedding({
      projectId, entityType: 'note', entityId: 'doc-guard', ...embedding,
    })).toBe('skipped_deleted')

    repository.upsertSearchDocument({
      id: 'search-doc-note-doc-guard',
      projectId,
      entityType: 'note',
      entityId: 'doc-guard',
      title: 'Doc',
      body: 'v1',
      contentHash: 'hash-v1',
      updatedAt: '2026-08-11T00:00:00.000Z',
    })
    expect(repository.commitSearchDocumentEmbedding({
      projectId, entityType: 'note', entityId: 'doc-guard', ...embedding,
    })).toBe('applied')

    // 内容更新后，旧 hash 的向量提交必须被丢弃。
    repository.upsertSearchDocument({
      id: 'search-doc-note-doc-guard',
      projectId,
      entityType: 'note',
      entityId: 'doc-guard',
      title: 'Doc',
      body: 'v2',
      contentHash: 'hash-v2',
      updatedAt: '2026-08-11T00:00:01.000Z',
    })
    expect(repository.commitSearchDocumentEmbedding({
      projectId, entityType: 'note', entityId: 'doc-guard', ...embedding,
    })).toBe('skipped_stale')
  })

  it('preview 风格晚写：revision 已删 → skipped_deleted 且不产生 dangling 行', () => {
    const { repository, projectId } = setup()
    let committed = 0
    const status = repository.commitDerivedResult({
      entityType: 'artifact',
      entityId: 'artifact-board',
      projectId,
      expectedRevisionId: 'revision-board-missing',
    }, () => { committed += 1 })
    expect(status).toBe('skipped_deleted')
    expect(committed).toBe(0)
    // 直接 upsert preview 到不存在的 revision 会被 FK 拒绝，不会静默 dangling。
    expect(() => repository.upsertPreviewRecord({
      id: 'preview-dangling',
      projectId,
      revisionId: 'revision-board-missing',
      sourceContentHash: 'hash',
      rendererId: 'r',
      rendererVersion: '1',
      previewProfile: 'default',
      cacheKey: 'k',
      cachePath: 'p',
      mimeType: 'image/png',
      size: 1,
      status: 'ready',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    })).toThrow()
  })
})
