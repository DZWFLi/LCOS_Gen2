import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createTextArtifact } from '../src/text-artifact-service.js'
import { SemanticIndexService } from '../src/semantic-index-service.js'

const cleanup: string[] = []

async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-hu1c-'))
  cleanup.push(dir)
  const projectRoot = join(dir, 'root')
  await mkdir(projectRoot, { recursive: true })
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  metadata.createProject({ id: 'hu1c-project' as never, name: 'HU1C', rootPath: projectRoot })
  return { dir, metadata, projectRoot }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('HU-1C FS staging + orphan sweep + late writer guard', () => {
  it('createTextArtifact writes staged then renames to final notes path', async () => {
    const { metadata, projectRoot } = await disposable()
    const result = await createTextArtifact(metadata, 'hu1c-project' as never, {
      body: 'staged text body',
      scopeId: 'scope-hu1c-project-root' as never,
    })
    const finalPath = join(projectRoot, '.creative-os', 'notes', `${result.fileRecordId.replace('file-', '')}.md`)
    expect(existsSync(finalPath)).toBe(true)
    expect(await readFile(finalPath, 'utf8')).toBe('staged text body')
    const stagingDir = join(projectRoot, '.creative-os', 'staging')
    expect(existsSync(join(stagingDir, `${result.fileRecordId.replace('file-', '')}.md`))).toBe(false)
  })

  it('DB failure removes staged file (no orphan)', async () => {
    const { metadata, projectRoot } = await disposable()
    // workspace 不存在 → workspace_memberships FK 失败 → composite 事务回滚
    await expect(createTextArtifact(metadata, 'hu1c-project' as never, {
      body: 'will fail',
      scopeId: 'scope-hu1c-project-root' as never,
      workspaceId: 'missing-workspace' as never,
    })).rejects.toThrow()
    const stagingDir = join(projectRoot, '.creative-os', 'staging')
    const staged = existsSync(stagingDir) ? (await (await import('node:fs/promises')).readdir(stagingDir)) : []
    expect(staged).toHaveLength(0)
    expect(metadata.getArtifacts('hu1c-project')).toHaveLength(0)
  })

  it('sweep removes orphan staged files and restores committed ones', async () => {
    const { metadata, projectRoot } = await disposable()
    const stagingDir = join(projectRoot, '.creative-os', 'staging')
    await mkdir(stagingDir, { recursive: true })
    // orphan：无 DB 引用
    await writeFile(join(stagingDir, 'orphan-1.md'), 'orphan')
    // committed-but-not-renamed：先正常创建后手动把文件移回 staging
    const result = await createTextArtifact(metadata, 'hu1c-project' as never, { body: 'committed', scopeId: 'scope-hu1c-project-root' as never })
    const id = result.fileRecordId.replace('file-', '')
    const finalPath = join(projectRoot, '.creative-os', 'notes', `${id}.md`)
    const { rename } = await import('node:fs/promises')
    await rename(finalPath, join(stagingDir, `${id}.md`))

    const outcome = metadata.sweepStagedTextFiles(projectRoot)
    expect(outcome.swept).toBe(1)
    expect(outcome.kept).toBe(1)
    expect(existsSync(join(stagingDir, 'orphan-1.md'))).toBe(false)
    expect(existsSync(finalPath)).toBe(true)
    expect(await readFile(finalPath, 'utf8')).toBe('committed')
  })

  it('late writer guard rejects deleted entities and mismatched hashes', async () => {
    const { metadata } = await disposable()
    const result = await createTextArtifact(metadata, 'hu1c-project' as never, { body: 'guard me', scopeId: 'scope-hu1c-project-root' as never })
    expect(metadata.assertEntityAlive('hu1c-project', 'artifact', result.artifactId, result.revisionId === undefined ? undefined : undefined)).toBe(true)
    metadata.deleteArtifact(result.artifactId)
    expect(metadata.assertEntityAlive('hu1c-project', 'artifact', result.artifactId)).toBe(false)
    expect(metadata.assertEntityAlive('hu1c-project', 'unknown-type', 'x')).toBe(false)
  })

  it('semantic indexEntity drops results for deleted entities (no resurrect)', async () => {
    const { metadata, projectRoot } = await disposable()
    const result = await createTextArtifact(metadata, 'hu1c-project' as never, { body: 'semantic guard', scopeId: 'scope-hu1c-project-root' as never })
    metadata.deleteArtifact(result.artifactId)
    const semantic = new SemanticIndexService(metadata)
    const outcome = await semantic.indexEntity({
      projectId: 'hu1c-project',
      entityType: 'artifact',
      entityId: result.artifactId,
      title: 'deleted',
      body: 'should not index',
    })
    expect(outcome.indexed).toBe(false)
  })
})
