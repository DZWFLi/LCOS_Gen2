import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { REAL_DEV_PROJECT_ID, ensureRealDevProject } from '../src/real-dev-project.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('ensureRealDevProject（真实 dev 工作台，替代 MVP sample 作为前端默认）', () => {
  it('首次种入真实项目（3 个真实工件 + 工作区），幂等：二次调用不重复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcos-real-dev-'))
    cleanup.push(root)
    const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
    repositories.push(repository)

    const first = ensureRealDevProject(repository, join(root, 'workspace'))
    expect(first).toBe(true)
    const project = repository.getProject(REAL_DEV_PROJECT_ID)
    expect(project?.name).toBe('LCOS Gen2 开发工作台')
    const artifacts = repository.getArtifacts(REAL_DEV_PROJECT_ID)
    expect(artifacts.map((artifact) => artifact.title).sort()).toEqual(['当前里程碑', '施工纪律', '项目定位'])

    const second = ensureRealDevProject(repository, join(root, 'workspace'))
    expect(second).toBe(false)
    expect(repository.getArtifacts(REAL_DEV_PROJECT_ID)).toHaveLength(3)
  })
})
