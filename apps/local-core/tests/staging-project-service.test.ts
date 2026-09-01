import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { StagingProjectService } from '../src/staging-project-service.js'
import type { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'

const cleanup: string[] = []

function snapshot(): ProjectGraphSnapshot {
  const now = '2026-08-12T00:00:00.000Z'
  const projectId = 'disposable-staging-project' as ProjectGraphSnapshot['project']['id']
  return {
    schemaVersion: 33,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: { id: projectId, name: 'Staging Fixture', rootPath: 'disposable://staging', graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'], createdAt: now, updatedAt: now },
    scopes: [{ id: 'scope-root', projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [],
    artifacts: [],
    artifactViews: [],
    artifactRevisions: [],
    fileRecords: [],
    relations: [],
    notes: [],
    checkpoints: [],
  }
}

describe('Phase 5 Slice 2 — create project from staging', () => {
  afterEach(async () => {
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('creates a project, imports text captures and marks them resolved', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-staging-project-'))
    cleanup.push(directory)
    const metadata = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    metadata.save(snapshot())
    const blobRoot = join(directory, 'blobs')
    await mkdir(blobRoot, { recursive: true })
    const staging = new CaptureStagingService(metadata, blobRoot)
    const text = '从暂存创建的正文'
    const hash = createHash('sha256').update(text).digest('hex')
    await writeFile(join(blobRoot, hash), text)
    const item = await staging.enqueue({
      operationId: 'staging-op-1',
      kind: 'clipboard_text',
      payloadRef: `blob:${hash}`,
      source: { app: 'test', title: '测试捕获' },
      suggestedProjects: [],
      capturedAt: '2026-08-12T00:00:00.000Z',
    })
    const resources = {
      importUrl: async () => ({ artifactId: 'a', resourceId: 'r', viewId: 'v', reused: false }),
      importFile: async () => ({ artifactId: 'a', resourceId: 'r', viewId: 'v', reused: false }),
    } as unknown as UniversalResourceImportService
    const service = new StagingProjectService(metadata, staging, resources, blobRoot)
    const parent = join(directory, 'projects')
    const result = await service.createProject({ captureIds: [item.id], titleMode: 'auto', parentPath: parent })
    expect(result.imported).toBe(1)
    expect(metadata.getProject(result.projectId)).toBeDefined()
    expect(metadata.getCaptureStagingItem(item.id)?.resolvedProjectId).toBe(result.projectId)
    const graph = metadata.get(result.projectId)
    expect(graph?.artifacts.some((artifact) => String(artifact.title).includes('测试捕获'))).toBe(true)
  })

  it('rejects already-resolved captures and missing ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-core-staging-project-fail-'))
    cleanup.push(directory)
    const metadata = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
    metadata.save(snapshot())
    const blobRoot = join(directory, 'blobs')
    const staging = new CaptureStagingService(metadata, blobRoot)
    const resources = {} as unknown as UniversalResourceImportService
    const service = new StagingProjectService(metadata, staging, resources, blobRoot)
    await expect(service.createProject({ captureIds: ['missing'], titleMode: 'auto', parentPath: directory })).rejects.toThrow(/do not exist/)
    const item = await staging.enqueue({ operationId: 'staging-op-2', kind: 'web_link', payloadRef: 'https://example.com', source: {}, suggestedProjects: [], capturedAt: '2026-08-12T00:00:00.000Z' })
    staging.resolve(item.id, 'disposable-staging-project')
    await expect(service.createProject({ captureIds: [item.id], titleMode: 'auto', parentPath: directory })).rejects.toThrow(/already belong to a project/)
  })
})
