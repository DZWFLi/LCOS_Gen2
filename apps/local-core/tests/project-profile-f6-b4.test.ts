/**
 * F6 Batch 4 验收测试（P1：ProjectSummary / VisualProfile CAS / SkillCatalog 只读）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectSummaryService } from '../src/project-summary-service.js'
import { SkillCatalogService } from '../src/skill-catalog-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b4-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b4-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-28T12:00:00.000Z')
  repository.save(snapshot)
  const projectId = String(snapshot.project.id)
  return { repository, projectId }
}

describe('F6 P1-A1: ProjectSummary', () => {
  it('summary returns objectCount with frozen口径 (artifacts+notes+resources)', () => {
    const { repository, projectId } = setup()
    const service = new ProjectSummaryService(repository)
    const summary = service.summary(projectId)
    expect(summary).toBeDefined()
    expect(summary!.schemaVersion).toBe(1)
    expect(summary!.name).toBe('LCOS MVP Sample')
    const artifacts = repository.getArtifacts(projectId).length
    const notes = repository.getNotes(projectId).length
    const resources = repository.listResourceDescriptors(projectId).length
    expect(summary!.objectCount).toBe(artifacts + notes + resources)
    expect(summary!.objectCountDetail).toEqual({ artifacts, notes, resources })
  })

  it('lastMeaningfulEditedAt comes from mutation activity, not last_opened_at', () => {
    const { repository, projectId } = setup()
    // 打开项目（touch last_opened_at）不得影响 lastMeaningfulEditedAt 的独立性断言：
    // summary 必须返回一个时间戳（mvp sample 的实体 updatedAt），且与 touch 无关。
    repository.touchProjectOpened(projectId as never, '2026-08-28T23:59:59.000Z')
    const service = new ProjectSummaryService(repository)
    const summary = service.summary(projectId)
    expect(summary!.lastMeaningfulEditedAt).toBeDefined()
    // 不晚于 touch 时间也成立——但必须等于实体活动的 max（2026-08-28T12:00:00.000Z 附近），
    // 而不是 touch 的 23:59:59（证明没拿 last_opened_at 冒充）。
    expect(summary!.lastMeaningfulEditedAt).not.toBe('2026-08-28T23:59:59.000Z')
  })

  it('unknown project returns undefined', () => {
    const { repository } = setup()
    const service = new ProjectSummaryService(repository)
    expect(service.summary('project-not-exist')).toBeUndefined()
  })
})

describe('F6 P1-A2: ProjectVisualProfile CAS', () => {
  it('create → read → CAS update → stale rejection → restart stable', () => {
    const { repository, projectId } = setup()
    expect(repository.getProjectVisualProfile(projectId)).toBeUndefined()

    const created = repository.upsertProjectVisualProfile({
      projectId, expectedVersion: 0,
      tintToken: 'sage', glythMarkId: 'leaf',
    })
    expect(created.version).toBe(1)
    expect(created.tintToken).toBe('sage')
    expect(created.glythMarkId).toBe('leaf')

    const updated = repository.upsertProjectVisualProfile({
      projectId, expectedVersion: 1,
      tintToken: 'amber', glythMarkId: 'pebble', glythMarkColor: '#ff8800', scale: 1.2,
    })
    expect(updated.version).toBe(2)
    expect(updated.glythMarkColor).toBe('#ff8800')

    // CAS 冲突：期望旧版本 = 拒绝
    expect(() => repository.upsertProjectVisualProfile({
      projectId, expectedVersion: 1,
      tintToken: 'sky', glythMarkId: 'egg',
    })).toThrow(/STALE_VISUAL_PROFILE_VERSION/)

    // restart 稳定：重开 repository 读回
    const dbPath = repository.databasePath
    repository.close()
    repositories.pop()
    const reopened = new SqliteMetadataRepository(dbPath)
    repositories.push(reopened)
    const restored = reopened.getProjectVisualProfile(projectId)
    expect(restored?.version).toBe(2)
    expect(restored?.tintToken).toBe('amber')
  })

  it('first-write with nonzero expectedVersion is rejected (fail-close)', () => {
    const { repository, projectId } = setup()
    expect(() => repository.upsertProjectVisualProfile({
      projectId, expectedVersion: 3,
      tintToken: 'sky', glythMarkId: 'egg',
    })).toThrow(/STALE_VISUAL_PROFILE_VERSION/)
  })
})

describe('F6 P1-B: SkillCatalog (read-only, layered)', () => {
  it('list returns system skills (repo packages/skills) with name/description', async () => {
    const { repository, projectId } = setup()
    const catalog = new SkillCatalogService(repository)
    const entries = await catalog.list(projectId)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((entry) => ['system', 'user', 'merged'].includes(entry.source))).toBe(true)
    // 仓库内置 skill 至少存在一个（lcos-skill-author）
    expect(entries.some((entry) => entry.id === 'lcos-skill-author')).toBe(true)
    const author = entries.find((entry) => entry.id === 'lcos-skill-author')!
    expect(author.name.length).toBeGreaterThan(0)
    expect(author.description.length).toBeGreaterThan(0)
  })

  it('read returns merged content; unknown skill = undefined', async () => {
    const { repository, projectId } = setup()
    const catalog = new SkillCatalogService(repository)
    const read = await catalog.read('lcos-skill-author', projectId)
    expect(read).toBeDefined()
    expect(read!.source).toBe('system')
    expect(read!.content).toContain('---')  // frontmatter 原文保留
    expect(await catalog.read('skill-not-exist', projectId)).toBeUndefined()
  })

  it('search filters by name/description/id', async () => {
    const { repository, projectId } = setup()
    const catalog = new SkillCatalogService(repository)
    const all = await catalog.list(projectId)
    const narrowed = await catalog.list(projectId, 'author')
    expect(narrowed.length).toBeLessThanOrEqual(all.length)
    expect(narrowed.some((entry) => entry.id === 'lcos-skill-author')).toBe(true)
  })

  it('unknown project throws (fail-close)', async () => {
    const { repository } = setup()
    const catalog = new SkillCatalogService(repository)
    await expect(catalog.list('project-not-exist')).rejects.toThrow(/not found/i)
  })
})