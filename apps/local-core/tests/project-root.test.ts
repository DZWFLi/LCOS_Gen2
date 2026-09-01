import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createProjectRoot, validateProjectRoot, type ReadonlyFileSystem } from '../src/project-root.js'

const disposablePaths: string[] = []

async function createFixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'local-core-phase-1a-'))
  disposablePaths.push(path)
  return path
}

afterEach(() => {
  // Windows：递归 rm 偶发被 AV/文件锁短暂拖慢，等待它会让 afterEach 撞 10s 超时
  // （Buddy 观察：失败用例都建了子目录）。改为非阻塞清理：hook 立即返回，
  // 删除失败也只留下系统临时目录垃圾，由 OS 兜底。
  const paths = disposablePaths.splice(0)
  for (const path of paths) {
    void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
  }
})

describe('validateProjectRoot', () => {
  it('normalizes and accepts a readable directory without writing to it', async () => {
    const root = await createFixtureDirectory()

    await expect(validateProjectRoot(root)).resolves.toEqual({
      ok: true,
      value: {
        normalizedPath: resolve(root),
        exists: true,
        isDirectory: true,
        readable: true,
      },
    })
  })

  it('rejects an empty path', async () => {
    await expect(validateProjectRoot('   ')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('rejects a missing directory', async () => {
    const parent = await createFixtureDirectory()

    await expect(validateProjectRoot(join(parent, 'missing'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_ROOT_NOT_FOUND' },
    })
  })

  it('rejects a file path', async () => {
    const parent = await createFixtureDirectory()
    const file = join(parent, 'not-a-directory.txt')
    await writeFile(file, 'disposable test fixture', 'utf8')

    await expect(validateProjectRoot(file)).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_ROOT_NOT_DIRECTORY' },
    })
  })

  it('maps an unreadable directory to a stable error', async () => {
    const unreadableFileSystem: ReadonlyFileSystem = {
      async stat() {
        return { isDirectory: () => true }
      },
      async access() {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
    }

    await expect(validateProjectRoot('C:\\restricted', { fileSystem: unreadableFileSystem })).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_ROOT_NOT_READABLE', origin: 'runtime' },
    })
  })

  it('rejects paths outside an explicitly configured allowed root', async () => {
    const allowedRoot = await createFixtureDirectory()
    const outsideRoot = await createFixtureDirectory()

    await expect(validateProjectRoot(outsideRoot, { allowedRoot })).resolves.toMatchObject({
      ok: false,
      error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
    })
  })

  it('returns ABORTED without touching the filesystem', async () => {
    const controller = new AbortController()
    controller.abort()
    const fileSystem: ReadonlyFileSystem = {
      async stat() {
        throw new Error('must not run')
      },
      async access() {
        throw new Error('must not run')
      },
    }

    await expect(validateProjectRoot('C:\\project', {
      signal: controller.signal,
      fileSystem,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ABORTED' },
    })
  })
})

describe('createProjectRoot', () => {
  it('creates exactly one child directory under an existing parent', async () => {
    const parent = await createFixtureDirectory()
    await expect(createProjectRoot(parent, 'summer-campaign')).resolves.toMatchObject({
      ok: true,
      value: { normalizedPath: join(parent, 'summer-campaign'), created: true },
    })
    await expect(validateProjectRoot(join(parent, 'summer-campaign'))).resolves.toMatchObject({ ok: true })
  })

  it('rejects traversal, separators and an existing child', async () => {
    const parent = await createFixtureDirectory()
    await expect(createProjectRoot(parent, '../escape')).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await expect(createProjectRoot(parent, 'nested/name')).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    await createProjectRoot(parent, 'existing')
    await expect(createProjectRoot(parent, 'existing')).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  })
})
