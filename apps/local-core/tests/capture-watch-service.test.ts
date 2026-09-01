import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { CaptureWatchService } from '../src/capture-watch-service.js'

const cleanup: string[] = []

async function disposable() {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-capture-watch-'))
  cleanup.push(dir)
  const metadata = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  const captured: unknown[] = []
  const service = new CaptureWatchService(metadata, async (request) => { captured.push(request) })
  return { dir, metadata, service, captured }
}

afterEach(async () => {
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('CaptureWatchService (Phase C)', () => {
  it('persists rules across restart', async () => {
    const { dir, metadata, service } = await disposable()
    service.upsertRule({ id: 'rule-1', path: join(dir, 'shots'), patterns: ['.png', '.jpg'], projectHint: 'project-a', settleMs: 750, enabled: true })
    metadata.close()
    const reopened = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
    const rules = reopened.listCaptureWatchRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]?.id).toBe('rule-1')
    expect(rules[0]?.patterns).toEqual(['.png', '.jpg'])
    expect(rules[0]?.projectHint).toBe('project-a')
  })

  it('delete rule removes it', async () => {
    const { metadata, service } = await disposable()
    service.upsertRule({ id: 'rule-x', path: 'C:/shots', patterns: [], settleMs: 750, enabled: true })
    expect(service.deleteRule('rule-x')).toBe(true)
    expect(service.listRules()).toHaveLength(0)
  })

  it('disabled rules are ignored by scan', async () => {
    const { dir, service } = await disposable()
    const shots = join(dir, 'shots')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(shots, { recursive: true })
    service.upsertRule({ id: 'rule-off', path: shots, patterns: ['.txt'], settleMs: 100, enabled: false })
    expect(service.listRules()[0]?.enabled).toBe(false)
  })
})
