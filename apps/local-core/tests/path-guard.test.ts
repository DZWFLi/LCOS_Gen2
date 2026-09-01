import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { guardTrustedFilePath } from '../src/path-guard.js'

const cleanup: string[] = []

afterEach(() => {
  for (const directory of cleanup.splice(0)) void Promise.resolve().then(() => { try { rmSync(directory, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(directory)
  return directory
}

describe('PathGuard', () => {
  it('accepts a readable file inside the trusted project root', () => {
    const root = tempDirectory('path-guard-root-')
    const file = join(root, 'source.md')
    writeFileSync(file, '# source', 'utf8')

    const guarded = guardTrustedFilePath(file, { projectRoot: root, allowExternalSource: false })

    expect(guarded.realPath).toBe(file)
    expect(guarded.size).toBe(Buffer.byteLength('# source'))
  })

  it('rejects a file outside the trusted project root', () => {
    const root = tempDirectory('path-guard-root-')
    const outside = tempDirectory('path-guard-outside-')
    const file = join(outside, 'source.md')
    writeFileSync(file, '# outside', 'utf8')

    expect(() => guardTrustedFilePath(file, {
      projectRoot: root,
      allowExternalSource: false,
    })).toThrow('outside the allowed project root')
  })

  it('rejects a symlink or junction that escapes the trusted root', (context) => {
    const root = tempDirectory('path-guard-root-')
    const outside = tempDirectory('path-guard-outside-')
    const outsideFile = join(outside, 'secret.txt')
    const link = join(root, 'linked-outside')
    writeFileSync(outsideFile, 'secret', 'utf8')
    mkdirSync(root, { recursive: true })
    try {
      symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : 'unknown'
      context.skip(`Symlink/junction creation is unavailable in this environment (${code}).`)
      return
    }

    expect(() => guardTrustedFilePath(join(link, 'secret.txt'), {
      projectRoot: root,
      allowExternalSource: false,
    })).toThrow('outside the allowed project root')
  })
})
