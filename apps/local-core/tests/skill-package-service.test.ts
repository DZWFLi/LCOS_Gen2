import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { SkillPackageService, SkillPathEscapeError } from '../src/skill-package-service.js'

const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

const VALID_CONTENT = `---
name: my-project-skill
description: 项目自有 skill 测试
version: 0.1.0
---

# My Project Skill

正文。
`

function systemSkillsRoot(): string {
  return fileURLToPath(new URL('../../../packages/skills', import.meta.url))
}

async function hashDir(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  const parts: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const relative = join(entry.parentPath ?? entry.path, entry.name).slice(dir.length)
    const content = await readFile(join(dir, relative), 'utf8')
    parts.push(`${relative}:${createHash('sha256').update(content).digest('hex')}`)
  }
  return parts.sort().join('|')
}

describe('SkillPackageService', () => {
  it('creates, updates, renames, bumps, disables and enables a project user skill', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-pkg-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const service = new SkillPackageService(repository)
    const projectId = String(snapshot.project.id)
    try {
      // create
      const created = await service.create(projectId, 'my-project-skill', VALID_CONTENT)
      expect(created.id).toBe('my-project-skill')
      expect(created.source).toBe('user')
      expect(created.disabled).toBe(false)
      expect(created.version).toBe('0.1.0')
      expect(created.provenance?.origin).toBe('user')
      expect(created.provenance?.versionHistory).toEqual([])

      // update
      const updated = await service.update(projectId, 'my-project-skill', VALID_CONTENT.replace('正文。', '正文 v2。'))
      expect(updated.provenance!.updatedAt >= created.provenance!.updatedAt).toBe(true)

      // version-bump（frontmatter 单行 version + history 追加）
      const bumped = await service.versionBump(projectId, 'my-project-skill', '0.2.0')
      expect(bumped.version).toBe('0.2.0')
      expect(bumped.provenance?.versionHistory).toEqual(['0.2.0'])
      const raw = await readFile(join(snapshot.project.rootPath, '.creative-os', 'skills', 'my-project-skill', 'SKILL.md'), 'utf8')
      expect(raw.match(/^version: .*$/gm)).toHaveLength(1)

      // rename
      const renamed = await service.rename(projectId, 'my-project-skill', 'renamed-skill')
      expect(renamed.id).toBe('renamed-skill')
      expect(await service.listUserSkillIds(projectId)).toEqual(['renamed-skill'])

      // disable / enable roundtrip（sidecar marker）
      const disabled = await service.setDisabled(projectId, 'renamed-skill', true)
      expect(disabled.disabled).toBe(true)
      const enabled = await service.setDisabled(projectId, 'renamed-skill', false)
      expect(enabled.disabled).toBe(false)

      // 与读取层集成：listLayeredSkills 立即可见
      const listed = await service.list(projectId)
      const entry = listed.find((item) => item.id === 'renamed-skill')
      expect(entry).toBeDefined()
      expect(entry!.name).toBe('my-project-skill')
    } finally {
      repository.close()
    }
  })

  it('rejects invalid SKILL.md content (missing frontmatter / name / description)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-pkg-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const service = new SkillPackageService(repository)
    try {
      await expect(service.create(String(snapshot.project.id), 'bad-skill', 'no frontmatter')).rejects.toThrow('SKILL.md invalid')
      await expect(service.create(String(snapshot.project.id), 'bad-skill', '---\nname: x\n---\nbody')).rejects.toThrow('description')
    } finally {
      repository.close()
    }
  })

  it('rejects path-escape ids with SkillPathEscapeError (write protection, attack)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-pkg-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const service = new SkillPackageService(repository)
    const projectId = String(snapshot.project.id)
    const before = await hashDir(systemSkillsRoot())
    try {
      for (const attack of ['..', '../..', 'a..b', 'My-Skill', 'my_skill', 'my/skill', 'my\\skill', 'C:system', 'my skill', '-leading']) {
        await expect(service.create(projectId, attack, VALID_CONTENT)).rejects.toBeInstanceOf(SkillPathEscapeError)
        await expect(service.rename(projectId, 'x', attack)).rejects.toBeInstanceOf(SkillPathEscapeError)
      }
      // 系统层与项目根均未被写入
      expect(await hashDir(systemSkillsRoot())).toBe(before)
      expect(existsSync(join(systemSkillsRoot(), '..', '..', 'my-project-skill'))).toBe(false)
    } finally {
      repository.close()
    }
  })

  it('installs a system skill as a user copy without touching the system layer (write protection)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-pkg-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const service = new SkillPackageService(repository)
    const projectId = String(snapshot.project.id)
    const systemRoot = systemSkillsRoot()
    const systemBefore = await hashDir(systemRoot)
    try {
      const installed = await service.install(projectId, 'lcos-skill-author')
      expect(installed.id).toBe('lcos-skill-author')
      expect(installed.source).toBe('merged') // system 原文 + user 副本合并视图
      expect(installed.provenance?.origin).toBe('installed')
      expect(installed.provenance?.sourceSkillId).toBe('lcos-skill-author')

      // user 副本真实落盘
      const userCopy = join(snapshot.project.rootPath, '.creative-os', 'skills', 'lcos-skill-author', 'SKILL.md')
      expect(existsSync(userCopy)).toBe(true)

      // 系统层逐字节未变（写保护核心断言）
      expect(await hashDir(systemRoot)).toBe(systemBefore)

      // 重复 install 拒绝
      await expect(service.install(projectId, 'lcos-skill-author')).rejects.toThrow('already installed')

      // 不存在的 system skill
      await expect(service.install(projectId, 'no-such-system-skill')).rejects.toThrow('not found')
    } finally {
      repository.close()
    }
  })

  it('validate checks structure without writing anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lcos-skill-pkg-'))
    cleanup.push(directory)
    const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    const snapshot = createMvpSampleSnapshot(directory, '2026-08-30T09:00:00.000Z')
    repository.save(snapshot)
    const service = new SkillPackageService(repository)
    try {
      const good = service.validate(VALID_CONTENT)
      expect(good.valid).toBe(true)
      expect(good.warnings).toEqual(['未声明 role'])  // VALID_CONTENT 无 role → 如实 warn

      const bad = service.validate('---\nname: only-name\n---\nbody')
      expect(bad.valid).toBe(false)
      expect(bad.errors).toContain('frontmatter 缺少 description')

      expect(await service.listUserSkillIds(String(snapshot.project.id))).toEqual([])
    } finally {
      repository.close()
    }
  })
})
