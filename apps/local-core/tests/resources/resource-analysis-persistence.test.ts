import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../../src/metadata-repository.js'
import { resourceDescriptorHash } from '../../src/resources/resource-descriptor-service.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }) })

describe('durable resource analysis', () => {
  it('migrates resource policy storage and enforces analysis revision identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'lcos-analysis-'))
    roots.push(root)
    const path = join(root, 'metadata.sqlite')
    const first = new SqliteMetadataRepository(path)
    first.createProject({ id: 'project-a' as ProjectId, name: 'A', rootPath: root })
    expect(() => first.enqueueResourceAnalysis({ id: 'job-a', projectId: 'project-a', resourceId: 'resource-a', sourceRevisionId: 'missing-revision', analyzerVersion: 'v1' })).toThrow()
    expect(() => first.close()).not.toThrow()
    const second = new SqliteMetadataRepository(path)
    expect(second.schemaVersion).toBe(50)
    expect(second.claimResourceAnalysis('worker-a')).toBeUndefined()
    second.upsertResourcePolicy({ projectId: 'project-a', resourceId: 'resource-a', trustLevel: 'reviewed', approvedContext: true, executable: false, annotation: { note: 'human' } })
    expect(second.getResourcePolicy('project-a', 'resource-a')?.annotation).toEqual({ note: 'human' })
    second.close()
  })

  it('excludes volatile analysis timestamps from semantic hashes', () => {
    const base = { schemaVersion: '0', id: 'd', projectId: 'p', resourceId: 'r', artifactId: 'a', sourceRevisionId: 'v', source: { kind: 'file' }, display: { title: 'T' }, detectedKinds: [], capabilities: [], inputs: [], outputs: [], constraints: [], entrypoints: [], readFirst: [], understanding: { status: 'ready', warnings: [], analyzerVersion: 'v1', analyzedAt: '2026-01-01' }, trust: { level: 'untrusted', readable: true, executable: false, requiresApproval: false } } as const
    expect(resourceDescriptorHash(base)).toBe(resourceDescriptorHash({ ...base, understanding: { ...base.understanding, analyzedAt: '2026-02-01' } }))
  })
})






