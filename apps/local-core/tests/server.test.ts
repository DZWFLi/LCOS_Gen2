import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectCatalog, ProjectGraphSnapshot } from '@local-creative-os/contracts'

import { FileRegistryService, TrustedFileSelectionRegistry } from '../src/file-registry-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ExplicitProjectCatalog } from '../src/project-catalog.js'
import {
  createLocalCoreServer,
  LOCAL_CORE_DEV_PORT,
  type LocalCoreServer,
} from '../src/server.js'

const activeServers: LocalCoreServer[] = []
const activeRepositories: SqliteMetadataRepository[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()))
  for (const repository of activeRepositories.splice(0)) repository.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createMetadataRepository(projectRoot = 'disposable://portasplit'): SqliteMetadataRepository {
  const directory = mkdtempSync(join(tmpdir(), 'local-core-server-'))
  temporaryDirectories.push(directory)
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  activeRepositories.push(repository)
  const now = '2026-07-26T00:00:00.000Z'
  const projectId = 'disposable-portasplit' as ProjectGraphSnapshot['project']['id']
  const scopeId = 'scope-root' as ProjectGraphSnapshot['scopes'][number]['id']
  repository.save({
    schemaVersion: 3,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: {
      id: projectId,
      name: 'PortaSplit',
      rootPath: projectRoot,
      graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
      createdAt: now,
      updatedAt: now,
    },
    scopes: [{
      id: scopeId,
      projectId,
      parentScopeId: null,
      containerViewId: null,
      kind: 'root',
      name: 'Root',
      createdAt: now,
      updatedAt: now,
    }],
    workspaces: [],
    artifacts: [],
    artifactViews: [],
    relations: [],
    notes: [],
    artifactRevisions: [],
    fileRecords: [],
    checkpoints: [],
  })
  return repository
}

async function startServer(server = createLocalCoreServer()): Promise<{
  server: LocalCoreServer
  baseUrl: string
  port: number
}> {
  activeServers.push(server)
  const address = await server.start()
  return {
    server,
    baseUrl: `http://${address.host}:${address.port}`,
    port: address.port,
  }
}

describe('Local Core HTTP server', () => {
  it('publishes one stable loopback development port', () => {
    expect(LOCAL_CORE_DEV_PORT).toBe(43121)
  })

  it('serves health on loopback with no CORS grant', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/health`)

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'local-core',
      mode: 'phase_2_lite',
      version: '0.3.0-phase2',
    })
  })

  it('returns only the directory explicitly selected through the native picker', async () => {
    const directoryPicker = async ({ title }: { readonly title: string }) => ({
      path: title === '选择已有项目目录' ? 'E:\\Creative\\PortaSplit' : undefined,
      cancelled: false,
    })
    const { baseUrl } = await startServer(createLocalCoreServer({ directoryPicker }))
    const response = await fetch(`${baseUrl}/system/select-directory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '选择已有项目目录' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { path: 'E:\\Creative\\PortaSplit', cancelled: false },
    })
  })

  it.each(['0.0.0.0', '::', '192.168.1.10'])('rejects non-loopback host %s', (host) => {
    expect(() => createLocalCoreServer({ host })).toThrow('only bind to 127.0.0.1')
  })

  it.each([0, -1, Number.POSITIVE_INFINITY])('rejects invalid request timeout %s', (requestTimeoutMs) => {
    expect(() => createLocalCoreServer({ requestTimeoutMs })).toThrow('positive finite number')
  })

  it('serves only the explicitly injected project catalog', async () => {
    const entry = { id: 'p1', name: 'PortaSplit', rootPath: 'E:\\PortaSplit', graphVersion: 1 }
    const catalog = new ExplicitProjectCatalog([entry])
    const { baseUrl } = await startServer(createLocalCoreServer({ catalog }))
    const response = await fetch(`${baseUrl}/projects`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, value: [entry] })
  })

  it('rejects duplicate ids from the explicit catalog at the HTTP boundary', async () => {
    const catalog = new ExplicitProjectCatalog([
      { id: 'duplicate', name: 'One', rootPath: 'E:\\One' },
      { id: 'duplicate', name: 'Two', rootPath: 'E:\\Two' },
    ])
    const { baseUrl } = await startServer(createLocalCoreServer({ catalog }))
    const response = await fetch(`${baseUrl}/projects`)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it.each([
    {
      label: 'POST legacy scope discriminator',
      method: 'POST',
      path: '/projects/disposable-portasplit/notes',
      anchor: { scope: 'project' },
    },
    {
      label: 'PUT legacy scope discriminator',
      method: 'PUT',
      path: '/projects/disposable-portasplit/notes/note-1',
      anchor: { scope: 'artifact', artifactId: 'artifact-1' },
    },
    {
      label: 'POST page anchor without revisionId',
      method: 'POST',
      path: '/projects/disposable-portasplit/notes',
      anchor: { type: 'page', pageIndex: 0 },
    },
    {
      label: 'PUT page anchor with negative pageIndex',
      method: 'PUT',
      path: '/projects/disposable-portasplit/notes/note-1',
      anchor: { type: 'page', revisionId: 'revision-1', pageIndex: -1 },
    },
  ])('rejects invalid Note anchor: $label', async ({ method, path, anchor }) => {
    const metadataRepository = createMetadataRepository()
    const { baseUrl } = await startServer(createLocalCoreServer({ metadataRepository }))
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'note-1',
        projectId: 'disposable-portasplit',
        anchor,
        body: 'Review note',
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('accepts a Note using the new discriminated union anchor', async () => {
    const metadataRepository = createMetadataRepository()
    const { baseUrl } = await startServer(createLocalCoreServer({ metadataRepository }))
    const note = {
      id: 'note-scope',
      projectId: 'disposable-portasplit',
      anchor: { type: 'scope', scopeId: 'scope-root' },
      body: 'Scope review',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }
    const response = await fetch(`${baseUrl}/projects/disposable-portasplit/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(note),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, value: note })
  })

  it('returns 409 when an immutable checkpoint id is posted twice', async () => {
    const metadataRepository = createMetadataRepository()
    const { baseUrl } = await startServer(createLocalCoreServer({ metadataRepository }))
    const checkpoint = {
      id: 'checkpoint-1',
      projectId: 'disposable-portasplit',
      scopeId: 'scope-root',
      label: 'Review',
      snapshotJson: { graphVersion: 1 },
      createdAt: '2026-07-26T00:00:00.000Z',
    }
    const url = `${baseUrl}/projects/disposable-portasplit/checkpoints`
    const request = () => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(checkpoint),
    })

    expect((await request()).status).toBe(201)
    const duplicate = await request()
    expect(duplicate.status).toBe(409)
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('immutable') },
    })
  })

  it('serves preview records through a read-only project route', async () => {
    const metadataRepository = createMetadataRepository()
    const now = '2026-07-26T00:00:00.000Z'
    const projectId = 'disposable-portasplit' as ProjectGraphSnapshot['project']['id']
    const artifactId = 'artifact-brief' as ProjectGraphSnapshot['artifacts'][number]['id']
    const fileRecordId = 'file-brief' as ProjectGraphSnapshot['fileRecords'][number]['id']
    const revisionId = 'revision-brief' as ProjectGraphSnapshot['artifactRevisions'][number]['id']
    metadataRepository.save({
      schemaVersion: 5,
      graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
      project: {
        id: projectId,
        name: 'PortaSplit',
        rootPath: 'disposable://portasplit',
        graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
        createdAt: now,
        updatedAt: now,
      },
      scopes: [],
      workspaces: [],
      artifacts: [{
        id: artifactId,
        projectId,
        title: 'Brief',
        kind: 'markdown',
        availability: 'available',
        currentRevisionId: revisionId,
        createdAt: now,
        updatedAt: now,
      }],
      artifactViews: [],
      relations: [],
      notes: [],
      fileRecords: [{
        id: fileRecordId,
        projectId,
        observedPath: 'E:/sample/brief.md',
        observedHash: 'hash-brief' as ProjectGraphSnapshot['fileRecords'][number]['observedHash'],
        size: 42,
        modifiedAt: now,
        mimeType: 'text/plain',
        availability: 'current',
        observedAt: now,
      }],
      artifactRevisions: [{
        id: revisionId,
        artifactId,
        fileRecordId,
        contentHash: 'hash-brief' as ProjectGraphSnapshot['artifactRevisions'][number]['contentHash'],
        source: 'import',
        status: 'current',
        createdAt: now,
      }],
      checkpoints: [],
    })
    metadataRepository.upsertPreviewRecord({
      id: 'preview-brief' as never,
      projectId,
      revisionId,
      sourceContentHash: 'hash-brief' as never,
      rendererId: 'markdown-preview',
      rendererVersion: '0.1.0',
      previewProfile: 'card',
      cacheKey: 'preview:brief',
      cachePath: 'cache/brief.html',
      mimeType: 'text/html',
      size: 100,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    })
    const { baseUrl } = await startServer(createLocalCoreServer({ metadataRepository }))
    const response = await fetch(`${baseUrl}/projects/disposable-portasplit/preview-records`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: [{ id: 'preview-brief', revisionId: 'revision-brief', status: 'ready' }],
    })
  })

  it('generates a preview through revision id and profile only, then serves cached content by PreviewRecord id', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'local-core-server-preview-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'source.md')
    writeFileSync(sourcePath, '# Runtime preview\n', 'utf8')
    const metadataRepository = createMetadataRepository(directory)
    const selections = new TrustedFileSelectionRegistry()
    const fileRegistryService = new FileRegistryService(metadataRepository, selections)
    const registered = await fileRegistryService.registerSource(
      'disposable-portasplit' as ProjectGraphSnapshot['project']['id'],
      { selectionId: selections.registerTrustedPath(sourcePath).id },
    )
    const { baseUrl } = await startServer(createLocalCoreServer({
      metadataRepository,
      fileRegistryService,
      previewCacheRoot: join(directory, 'preview-cache'),
    }))
    const response = await fetch(`${baseUrl}/projects/disposable-portasplit/previews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revisionId: registered.revision.id, previewProfile: 'thumbnail' }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      value: { reused: false, record: { revisionId: registered.revision.id, status: 'ready' } },
    })
    const previewRecordId = body.value.record.id
    const content = await fetch(`${baseUrl}/projects/disposable-portasplit/preview-records/${previewRecordId}/content`)

    expect(content.status).toBe(200)
    await expect(content.json()).resolves.toMatchObject({
      ok: true,
      value: {
        previewRecordId,
        mimeType: 'text/plain',
        encoding: 'base64',
        data: Buffer.from('# Runtime preview\n').toString('base64'),
      },
    })
  })

  it('rejects preview generation requests containing browser-supplied paths', async () => {
    const metadataRepository = createMetadataRepository()
    const { baseUrl } = await startServer(createLocalCoreServer({ metadataRepository }))
    const response = await fetch(`${baseUrl}/projects/disposable-portasplit/previews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revisionId: 'revision-1', previewProfile: 'thumbnail', path: 'C:\\unsafe.md' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it.each(['path', 'absolutePath'])(
    'rejects browser source registration containing %s',
    async (pathField) => {
      const metadataRepository = createMetadataRepository()
      const fileRegistryService = new FileRegistryService(
        metadataRepository,
        new TrustedFileSelectionRegistry(),
      )
      const { baseUrl } = await startServer(createLocalCoreServer({
        metadataRepository,
        fileRegistryService,
      }))
      const response = await fetch(`${baseUrl}/projects/disposable-portasplit/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          selectionId: 'opaque-selection',
          [pathField]: 'C:\\untrusted\\source.md',
        }),
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      })
    },
  )

  it('accepts browser source registration through selectionId only', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'local-core-http-source-'))
    temporaryDirectories.push(projectRoot)
    const sourcePath = join(projectRoot, 'source.md')
    writeFileSync(sourcePath, '# trusted source', 'utf8')
    const metadataRepository = createMetadataRepository(projectRoot)
    const selections = new TrustedFileSelectionRegistry()
    const fileRegistryService = new FileRegistryService(metadataRepository, selections)
    const selection = selections.registerTrustedPath(sourcePath)
    const { baseUrl } = await startServer(createLocalCoreServer({
      metadataRepository,
      fileRegistryService,
    }))

    const response = await fetch(`${baseUrl}/projects/disposable-portasplit/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionId: selection.id }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: {
        fileRecord: { projectId: 'disposable-portasplit', observedPath: sourcePath },
        artifact: { currentRevisionId: expect.any(String) },
        revision: { source: 'import', status: 'current' },
      },
    })
  })

  it('refreshes FileRecord observation through an opaque FileRecord id only', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'local-core-http-observe-'))
    temporaryDirectories.push(projectRoot)
    const sourcePath = join(projectRoot, 'source.md')
    writeFileSync(sourcePath, '# trusted source', 'utf8')
    const metadataRepository = createMetadataRepository(projectRoot)
    const selections = new TrustedFileSelectionRegistry()
    const fileRegistryService = new FileRegistryService(metadataRepository, selections)
    const selection = selections.registerTrustedPath(sourcePath)
    const { baseUrl } = await startServer(createLocalCoreServer({
      metadataRepository,
      fileRegistryService,
    }))
    const registered = await fetch(`${baseUrl}/projects/disposable-portasplit/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionId: selection.id }),
    }).then((response) => response.json())
    writeFileSync(sourcePath, '# changed outside LCOS', 'utf8')

    const response = await fetch(`${baseUrl}/file-records/${registered.value.fileRecord.id}/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ignoredPath: 'C:\\must-not-be-read-from-browser.md' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: {
        fileRecord: { availability: 'stale' },
        artifact: { availability: 'stale' },
        revisionCreated: false,
      },
    })
    expect(metadataRepository.getArtifactRevisions(registered.value.artifact.id)).toHaveLength(1)
  })

  it('validates a project root through the HTTP boundary', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/project-roots/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: process.cwd() }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      value: { exists: true, isDirectory: true, readable: true },
    })
  })

  it('returns a stable error instead of a system stack', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/project-roots/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: '' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(JSON.stringify(body)).not.toContain('stack')
  })

  it('enforces the configured allowed root at the HTTP boundary', async () => {
    const { baseUrl } = await startServer(createLocalCoreServer({ allowedRoot: process.cwd() }))
    const response = await fetch(`${baseUrl}/project-roots/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: process.env.SystemRoot ?? 'C:\\Windows' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PATH_OUTSIDE_ALLOWED_ROOT' },
    })
  })

  it('rejects malformed JSON with a stable error', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/project-roots/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', origin: 'runtime' },
    })
  })

  it('rejects request bodies larger than the read-only limit', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/project-roots/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: 'x'.repeat(2 * 1024 * 1024) }), // 2 MiB > 1 MiB limit
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('returns a stable error for an unknown route', async () => {
    const { baseUrl } = await startServer()
    const response = await fetch(`${baseUrl}/not-a-route`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    })
  })

  it('aborts a slow boundary operation when the request timeout expires', async () => {
    const neverCompletes: ProjectCatalog = {
      async list() {
        return await new Promise(() => undefined)
      },
    }
    const { baseUrl } = await startServer(createLocalCoreServer({
      catalog: neverCompletes,
      requestTimeoutMs: 20,
    }))
    const response = await fetch(`${baseUrl}/projects`)

    expect(response.status).toBe(408)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'ABORTED', message: 'Request timed out.' },
    })
  })

  it('supports an aborted start signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const server = createLocalCoreServer()

    await expect(server.start(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(server.address()).toBeUndefined()
  })

  it('does not lose an abort raised while the server is starting', async () => {
    const controller = new AbortController()
    const server = createLocalCoreServer()
    const started = server.start(controller.signal)
    controller.abort()

    await expect(started).rejects.toMatchObject({ name: 'AbortError' })
    expect(server.address()).toBeUndefined()
  })

  it('uses the lifecycle signal to close an already started server', async () => {
    const controller = new AbortController()
    const { server, port } = await startServer(createLocalCoreServer())
    await server.close()

    const lifecycleServer = createLocalCoreServer({ port })
    activeServers.push(lifecycleServer)
    await lifecycleServer.start(controller.signal)
    controller.abort()

    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 20))
    expect(lifecycleServer.address()).toBeUndefined()

    const rebound = createServer()
    await new Promise<void>((resolvePromise, reject) => {
      rebound.once('error', reject)
      rebound.listen(port, '127.0.0.1', () => resolvePromise())
    })
    await new Promise<void>((resolvePromise) => rebound.close(() => resolvePromise()))
  })

  it('gracefully closes and releases its port for immediate rebinding', async () => {
    const { server, port } = await startServer()
    await server.close()

    const rebound = createServer()
    await new Promise<void>((resolvePromise, reject) => {
      rebound.once('error', reject)
      rebound.listen(port, '127.0.0.1', () => resolvePromise())
    })
    await new Promise<void>((resolvePromise, reject) => {
      rebound.close((error) => error ? reject(error) : resolvePromise())
    })
  })
})
