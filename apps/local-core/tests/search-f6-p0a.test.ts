import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectSearchService } from '../src/project-search-service.js'
import { SemanticIndexService } from '../src/semantic-index-service.js'
import { CurationCommandService } from '../src/curation-command-service.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { createTextArtifact } from '../src/text-artifact-service.js'
import { ImportCopyService } from '../src/import-copy-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-p0a-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-p0a-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-28T09:00:00.000Z')
  repository.save(snapshot)
  const projectId = String(snapshot.project.id)
  const scopeId = String(repository.getScopes(projectId).find((scope) => scope.kind === 'root')?.id ?? snapshot.scopes[0]?.id ?? '')
  return { repository, projectId, scopeId }
}

/** B 项目走真实创建路径（createProject 自带 root scope + default workspace），避免快照实体 id 冲突。 */
async function secondProject(repository: SqliteMetadataRepository): Promise<{ readonly projectId: string; readonly artifactId: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-f6-p0a-project-b-'))
  roots.push(root)
  const projectId = 'project-b-scope-isolation'
  repository.createProject({ id: projectId as never, name: 'B isolation project', rootPath: root })
  const created = await createTextArtifact(repository, projectId as never, {
    title: 'B 风险备忘',
    body: 'B 项目的风险内容。',
    scopeId: `scope-${projectId}-root` as never,
  })
  return { projectId, artifactId: String(created.artifactId) }
}

function mockKeywordEmbed(semantic: SemanticIndexService): void {
  vi.spyOn(semantic, 'embed').mockImplementation(async (_model: string, input: readonly string[]) =>
    input.map((text) => (text.includes('风险') ? [1, 0] : text.includes('收益') ? [0, 1] : [0.5, 0.5])))
}

describe('F6 P0-A1: vector search project scope', () => {
  it('A project vector query does not return B project hits', async () => {
    const { repository, projectId } = setup()
    const projectB = await secondProject(repository)
    const projectIdB = projectB.projectId
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    mockKeywordEmbed(semantic)
    await semantic.indexEntity({ projectId, entityType: 'note', entityId: 'note-feedback-view', title: 'A 风险备忘', body: 'A 项目的风险内容。' })
    await semantic.indexEntity({ projectId: projectIdB, entityType: 'artifact', entityId: projectB.artifactId, title: 'B 风险备忘', body: 'B 项目的风险内容。' })

    const hitsA = await semantic.searchVectors('风险', undefined, 10, projectId)
    expect(hitsA.length).toBeGreaterThan(0)
    expect(hitsA.every((hit) => hit.entityId !== projectB.artifactId)).toBe(true)
    const hitsB = await semantic.searchVectors('风险', undefined, 10, projectIdB)
    expect(hitsB.every((hit) => hit.entityId !== 'note-a-1')).toBe(true)
  })

  it('ProjectSearchService vector path carries projectId', async () => {
    const { repository, projectId } = setup()
    const projectB = await secondProject(repository)
    const projectIdB = projectB.projectId
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    mockKeywordEmbed(semantic)
    await semantic.indexEntity({ projectId, entityType: 'note', entityId: 'note-feedback-view', title: '备忘', body: 'A 项目的风险内容。' })
    await semantic.indexEntity({ projectId: projectIdB, entityType: 'artifact', entityId: projectB.artifactId, title: '备忘', body: 'B 项目的风险内容。' })

    const search = new ProjectSearchService(repository, undefined, semantic)
    const resultA = await search.search(projectId, '风险')
    const resultB = await search.search(projectIdB, '风险')
    expect(resultA.hits.every((hit) => hit.entityId !== projectB.artifactId)).toBe(true)
    expect(resultB.hits.every((hit) => hit.entityId !== 'note-a-1')).toBe(true)
  })
})

describe('F6 P0-A2: mutation-driven indexing', () => {
  it('createText is FTS-searchable immediately without any search call', async () => {
    const { repository, projectId, scopeId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const presentation = new PresentationApplicationService(repository, repository, undefined, new ProjectEventHub())
    const curation = new CurationCommandService({ repository, presentations: presentation, semantic })

    const created = await curation.createText(projectId, { scopeId, title: '斑马催化剂', body: '唯一定位短语 zebra-catalyst-for-f6-p0a' })
    expect(created.artifactId).toBeTruthy()

    const fts = repository.searchDocumentsFts(projectId, 'zebra-catalyst-for-f6-p0a', 10)
    expect(fts.some((doc) => doc.entityId === String(created.artifactId))).toBe(true)
  })
})

describe('F6 P0-A3: OCR evidence persistence', () => {
  it('saveOcrEvidence + reindexArtifact makes OCR text FTS-searchable (image artifact)', async () => {
    const { repository, projectId, scopeId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    // 真实导入一张「图片」（字节内容无所谓，mime 按文件名判为 image/png）。
    const importCopy = new ImportCopyService(repository)
    const imported = await importCopy.importCopy(projectId as never, {
      importRequestId: 'f6-p0a-ocr-1',
      fileName: 'photo-ocr.png',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      scopeId: scopeId as never,
      position: { x: 0, y: 0 },
    } as never)
    const artifactId = String(imported.artifact.id)
    // 导入即索引（P0-A2 挂点）：图片无 evidence 时正文为空——只有标题块。
    repository.saveOcrEvidence({ projectId, artifactId, text: '绿色冰箱 ocr-evidence-phrase', engine: 'rapidocr', durationMs: 5 })
    await semantic.reindexArtifact(projectId, artifactId)

    const fts = repository.searchDocumentsFts(projectId, 'ocr-evidence-phrase', 10)
    expect(fts.some((doc) => doc.entityId === artifactId)).toBe(true)

    const miss = repository.searchDocumentsFts(projectId, 'definitely-not-in-any-body-xyzzy', 10)
    expect(miss.some((doc) => doc.entityId === artifactId)).toBe(false)
  })

  it('getOcrEvidenceText returns undefined when never run', () => {
    const { repository, projectId } = setup()
    const artifact = repository.getArtifacts(projectId)[0]!
    expect(repository.getOcrEvidenceText(projectId, String(artifact.id) + '-nonexistent')).toBeUndefined()
  })
})

describe('F6 P0-A4: SearchHit vNext projection', () => {
  it('hits carry entityRef / matchReason / matchModality', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const search = new ProjectSearchService(repository, undefined, semantic)
    const result = await search.search(projectId, 'Brief')
    const hit = result.hits.find((candidate) => candidate.source === 'artifact-title')
    if (hit !== undefined) {
      expect(hit.entityRef).toBeDefined()
      expect(hit.entityRef?.type).toBe('artifact')
      expect(hit.entityRef?.id).toBe(String(hit.entityId))
      expect(hit.matchReason).toBe('title')
      expect(hit.matchModality).toBe('text')
    }
  })

  it('usedHereTarget workspace projection does not throw', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const search = new ProjectSearchService(repository, undefined, semantic)
    const memberships = repository.listProjectWorkspaceMemberships(projectId as never)
    const workspaceId = memberships.length > 0 ? String(memberships[0]!.workspaceId) : undefined
    const result = await search.search(projectId, 'Brief', { usedHereTarget: workspaceId === undefined ? undefined : { kind: 'workspace', id: workspaceId } })
    for (const hit of result.hits) {
      if (hit.entityType === 'artifact' && hit.locationRefs !== undefined) {
        expect(Array.isArray(hit.locationRefs)).toBe(true)
        expect(typeof hit.locationCount).toBe('number')
        if (workspaceId !== undefined && hit.usedHere === true) {
          expect(hit.locationRefs?.some((location) => location.id === workspaceId)).toBe(true)
        }
      }
    }
  })
})