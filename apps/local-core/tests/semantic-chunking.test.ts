import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectSearchService } from '../src/project-search-service.js'
import { chunkEntity, SemanticIndexService } from '../src/semantic-index-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-chunk-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-chunk-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-02T09:00:00.000Z')
  repository.save(snapshot)
  return { repository, projectId: String(snapshot.project.id) }
}

/** 关键词 mock 向量：含"风险"→[1,0]，含"收益"→[0,1]，其余→[0.5,0.5]。查询与块共用同一规则。 */
function mockKeywordEmbed(semantic: SemanticIndexService): void {
  vi.spyOn(semantic, 'embed').mockImplementation(async (_model: string, input: readonly string[]) =>
    input.map((text) => (text.includes('风险') ? [1, 0] : text.includes('收益') ? [0, 1] : [0.5, 0.5])))
}

describe('chunkEntity 分块策略（纯函数）', () => {
  it('多标题 markdown：标题块 + 按节分块，anchor=section:标题', () => {
    const plans = chunkEntity({
      title: '投资备忘录',
      body: '# 风险\n风险内容 A。\n\n# 收益\n收益内容 B。',
    })
    expect(plans.map((plan) => plan.chunkAnchor)).toEqual(['document', 'section:风险', 'section:收益'])
    expect(plans.map((plan) => plan.chunkKind)).toEqual(['title', 'body', 'body'])
    expect(plans.every((plan) => plan.chunkCount === 3)).toBe(true)
    expect(plans.map((plan) => plan.chunkIndex)).toEqual([0, 1, 2])
    // 节块保留标题行语境
    expect(plans[1]?.chunkText).toContain('# 风险')
  })

  it('超长节按段落再切，后续子块 anchor 追加 #2 后缀', () => {
    const longParagraphs = Array.from({ length: 100 }, (_, index) => `第${index}段内容，`.repeat(10)).join('\n\n')
    const plans = chunkEntity({ title: '长文', body: `# 大节\n${longParagraphs}` })
    const sectionChunks = plans.filter((plan) => plan.chunkAnchor.startsWith('section:大节'))
    expect(sectionChunks.length).toBeGreaterThan(1)
    expect(sectionChunks[0]?.chunkAnchor).toBe('section:大节')
    expect(sectionChunks[1]?.chunkAnchor).toBe('section:大节#2')
  })

  it('pdf 页文本（\\f 分页）：小页贪心聚合为范围锚点 pdf:p1-p3', () => {
    const plans = chunkEntity({
      title: '合同',
      body: '第一页内容。\f第二页内容。\f第三页内容。',
    })
    const pdfChunks = plans.filter((plan) => plan.chunkAnchor.startsWith('pdf:'))
    expect(pdfChunks).toHaveLength(1)
    expect(pdfChunks[0]?.chunkAnchor).toBe('pdf:p1-p3')
  })

  it('pdf 超大页内部再切（同页多块 #k 去重）', () => {
    const hugePage = '巨大页内容。'.repeat(1500)
    const plans = chunkEntity({ title: '大 PDF', body: `${hugePage}\f尾页内容。` })
    const pdfChunks = plans.filter((plan) => plan.chunkAnchor.startsWith('pdf:p1'))
    expect(pdfChunks.length).toBeGreaterThan(1)
    expect(pdfChunks[0]?.chunkAnchor).toBe('pdf:p1')
    expect(pdfChunks[1]?.chunkAnchor).toBe('pdf:p1#2')
  })

  it('无标题纯文本按段落窗口 anchor=chunk:a-b', () => {
    const plans = chunkEntity({ title: '笔记', body: '第一段。\n\n第二段。\n\n第三段。' })
    expect(plans.map((plan) => plan.chunkAnchor)).toEqual(['document', 'chunk:1-3'])
  })

  it('空 body 只剩标题块；全空返回空数组', () => {
    expect(chunkEntity({ title: '标题', body: '' })).toEqual([
      expect.objectContaining({ chunkAnchor: 'document', chunkKind: 'title', chunkIndex: 0, chunkCount: 1 }),
    ])
    expect(chunkEntity({ title: '', body: '' })).toEqual([])
  })

  it('同名标题去重 #2；per-chunk contentHash 相互独立', () => {
    const plans = chunkEntity({ title: 'T', body: '# 风险\nA\n\n# 风险\nB' })
    expect(plans.map((plan) => plan.chunkAnchor)).toEqual(['document', 'section:风险', 'section:风险#2'])
    const hashes = new Set(plans.map((plan) => plan.contentHash))
    expect(hashes.size).toBe(plans.length)
  })

  it('内容相同时 per-chunk hash 稳定（增量重算的前提）', () => {
    const first = chunkEntity({ title: 'T', body: '# A\nx' })
    const second = chunkEntity({ title: 'T', body: '# A\nx' })
    expect(first.map((chunk) => chunk.contentHash)).toEqual(second.map((chunk) => chunk.contentHash))
  })
})

describe('semantic index chunk 检索（集成，mock embed + 真库 sqlite）', () => {
  it('多标题 markdown 索引为多块；块级命中带 chunkAnchor，标题块为文档级命中', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    mockKeywordEmbed(semantic)
    const outcome = await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '投资备忘录',
      body: '# 风险\n本项目存在重大风险，需要仔细评估。\n\n# 收益\n预期收益可观。',
    })
    expect(outcome.indexed).toBe(true)
    expect(outcome.vector).toBe(true)

    const vectorHits = await semantic.searchVectors('风险')
    expect(vectorHits.length).toBeGreaterThan(0)
    const bodyHit = vectorHits.find((hit) => hit.chunkKind === 'body' && hit.chunkAnchor === 'section:风险')
    const titleHit = vectorHits.find((hit) => hit.chunkKind === 'title')
    expect(bodyHit).toBeDefined()
    expect(bodyHit?.chunkIndex).toBe(1)
    expect(bodyHit?.chunkCount).toBe(3)
    expect(bodyHit?.chunkText).toContain('# 风险')
    // 文档级命中：标题块不带锚点
    expect(titleHit?.chunkAnchor).toBeUndefined()
    expect(titleHit?.chunkText).toBe('投资备忘录')
  })

  it('ProjectSearchService 的 vector 命中携带 chunkAnchor（块级引用）', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    mockKeywordEmbed(semantic)
    await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '投资备忘录',
      body: '# 风险\n本项目存在重大风险，需要仔细评估。\n\n# 收益\n预期收益可观。',
    })
    const search = new ProjectSearchService(repository, undefined, semantic)
    const result = await search.search(projectId, '风险')
    const vectorHit = result.hits.find((hit) => hit.source === 'vector')
    expect(vectorHit).toBeDefined()
    expect(vectorHit?.chunkAnchor).toBe('section:风险')
    expect(vectorHit?.chunkIndex).toBe(1)
    expect(vectorHit?.chunkCount).toBe(3)
    expect(vectorHit?.snippet).toContain('风险')
  })

  it('per-chunk 差分增量：只重算变化块，未变内容整体跳过', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    mockKeywordEmbed(semantic)
    await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '备忘',
      body: '# 风险\nA 段。\n\n# 收益\nB 段。',
    })
    const embedCalls: string[][] = []
    vi.spyOn(semantic, 'embed').mockImplementation(async (_model: string, input: readonly string[]) => {
      embedCalls.push([...input])
      return input.map(() => [0.5, 0.5])
    })
    // 只改"收益"节 → 只有该节块重算（标题块与"风险"块 hash 不变）
    const second = await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '备忘',
      body: '# 风险\nA 段。\n\n# 收益\nB 段已更新。',
    })
    expect(second.indexed).toBe(true)
    expect(embedCalls).toHaveLength(1)
    expect(embedCalls[0]).toHaveLength(1)
    expect(embedCalls[0]?.[0]).toContain('收益')
    // 第三次同内容 → 完全跳过（文档 hash + 块集合 hash 均一致）
    const third = await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '备忘',
      body: '# 风险\nA 段。\n\n# 收益\nB 段已更新。',
    })
    expect(third.indexed).toBe(false)
  })

  it('Ollama 不可用时仍完成分块计划落库（FTS-only），下次同内容不重复处理', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const entity = {
      projectId,
      entityType: 'note' as const,
      entityId: 'note-feedback-view',
      title: '备忘',
      body: '# 风险\nA 段。\n\n# 收益\nB 段。',
    }
    const first = await semantic.indexEntity(entity)
    expect(first.indexed).toBe(true)
    expect(first.vector).toBe(false) // embed 不可达 → 仅 FTS + 分块计划
    // 分块计划已落库：同内容第二次直接跳过（与整文档 hash 跳过语义一致）
    const second = await semantic.indexEntity(entity)
    expect(second.indexed).toBe(false)
  })
})

describe('FTS 块级化 + 懒索引接线(核心能力 B,无 Ollama 环境)', () => {
  it('FTS 命中正文块带 chunkAnchor(块级);标题命中保持文档级(无 anchor)', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' }) // embed 不可达 → FTS-only
    await semantic.indexEntity({
      projectId,
      entityType: 'note',
      entityId: 'note-feedback-view',
      title: '投资备忘录',
      body: '# 风险\n本项目存在重大风险。\n\n# 收益\n预期收益可观。',
    })
    const search = new ProjectSearchService(repository, undefined, semantic)
    const result = await search.search(projectId, '风险')
    const ftsHit = result.hits.find((hit) => hit.source === 'search-document-fts')
    expect(ftsHit?.chunkAnchor).toBe('section:风险')
    expect(ftsHit?.chunkIndex).toBe(1)
    expect(ftsHit?.chunkCount).toBe(3)
    // 标题词命中 → 文档级,不带 anchor
    const titleResult = await search.search(projectId, '投资备忘录')
    const titleFts = titleResult.hits.find((hit) => hit.source === 'search-document-fts')
    expect(titleFts?.chunkAnchor).toBeUndefined()
  })

  it('懒索引:首次搜索自动补建 artifact 分块索引,正文块级命中随后可见', async () => {
    const { repository, projectId } = setup()
    const semantic = new SemanticIndexService(repository, { ollamaUrl: 'http://127.0.0.1:1' })
    const search = new ProjectSearchService(repository, undefined, semantic)
    // 不手动 indexEntity——首次搜索应触发 #ensureProjectIndexed(样本 artifact 的 md 被分块落库)。
    // Feedback 正文含 'reality gate':artifact-text/FTS 任一路径命中都应带块级锚点(dedup 后保留最高分那条)。
    const result = await search.search(projectId, 'reality gate')
    const feedbackHit = result.hits.find((hit) => hit.title === 'Feedback Notes')
    expect(feedbackHit).toBeDefined()
    expect(feedbackHit?.chunkAnchor).toBe('section:Feedback') // 正文块锚点
    expect(feedbackHit?.chunkIndex).toBe(1)
    expect(feedbackHit?.chunkCount).toBe(2)
    // 二次搜索不重复 ensure(进程缓存),结果一致
    const again = await search.search(projectId, 'reality gate')
    const againHit = again.hits.find((hit) => hit.title === 'Feedback Notes')
    expect(againHit?.chunkAnchor).toBe('section:Feedback')
  })
})
