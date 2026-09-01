import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'

import type {
  ImportResourceResultV1,
  ResourceDescriptorV0,
  ResourceId,
  ResourceUnderstandingStatus,
} from '@local-creative-os/contracts'
import type { Artifact, ArtifactRevision, ArtifactView, FileRecord, ProjectId, ScopeId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../metadata-repository.js'
import { ResourceDescriptorService } from './resource-descriptor-service.js'
import { readZipArchive, ZipReadError } from './zip-reader.js'

const MAX_PACKAGE_FILES = 200
const MAX_PACKAGE_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_PACKAGE_SINGLE_BYTES = 10 * 1024 * 1024
const MAX_PACKAGE_DEPTH = 8

const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build', '.cache', '.next', '.turbo', 'coverage',
])

const IGNORED_FILE_NAMES = new Set([
  '.env', '.token_private.json', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials.json', 'secrets.json',
])

const IGNORED_FILE_SUFFIXES = ['.key', '.pem', '.p12', '.pfx']
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
])

export class ResourcePackageConflictError extends Error {
  readonly code = 'IMPORT_REQUEST_CONFLICT'
}

export interface PackageFileInput {
  readonly path: string
  readonly bytes: Buffer
}

export interface ImportDirectoryInput {
  readonly importRequestId: string
  readonly rootName: string
  readonly files: readonly PackageFileInput[]
  readonly scopeId: string
  readonly position: { readonly x: number; readonly y: number }
  readonly userNote?: string
}

export interface ImportArchiveInput {
  readonly importRequestId: string
  readonly fileName: string
  readonly bytes: Buffer
  readonly scopeId: string
  readonly position: { readonly x: number; readonly y: number }
  readonly userNote?: string
}

export interface ResourcePackageOutcome extends ImportResourceResultV1 {
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly revision: ArtifactRevision
  readonly view: ArtifactView
  readonly reused: boolean
}

interface ManifestEntry {
  readonly path: string
  readonly size: number
  readonly contentHash: string
}

function packageIdentity(projectId: ProjectId, requestId: string): string {
  return createHash('sha256')
    .update(String(projectId)).update('\0').update('pkg').update('\0').update(requestId)
    .digest('hex').slice(0, 24)
}

function safePackagePath(rawPath: string): string | undefined {
  let path = rawPath.normalize('NFC').replace(/\\/g, '/')
  path = path.replace(/^\/+/, '')
  if (/^[a-z]:/i.test(path)) return undefined
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined
  if (segments.length > MAX_PACKAGE_DEPTH) return undefined
  if (segments.some((segment) => IGNORED_DIRECTORIES.has(segment.toLocaleLowerCase('en-US')))) return undefined
  if (segments.some((segment) => segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':'))) return undefined
  if (segments.some((segment) => WINDOWS_RESERVED_NAMES.has(segment.split('.')[0]!.toLocaleLowerCase('en-US')))) return undefined
  const fileName = segments.at(-1) ?? ''
  if (IGNORED_FILE_NAMES.has(fileName.toLocaleLowerCase('en-US'))) return undefined
  if (IGNORED_FILE_SUFFIXES.some((suffix) => fileName.toLocaleLowerCase('en-US').endsWith(suffix))) return undefined
  if (fileName.length === 0 || fileName.length > 240 || path.length > 1024) return undefined
  return path
}

function packageFingerprint(rootName: string, files: readonly { readonly path: string; readonly bytes: Buffer }[]): string {
  const hash = createHash('sha256').update(rootName.normalize('NFC')).update('\0')
  for (const file of files) {
    hash.update(file.path).update('\0')
    hash.update(createHash('sha256').update(file.bytes).digest('hex')).update('\0')
  }
  return hash.digest('hex')
}

function isInsideDirectory(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !fromRoot.match(/^[a-z]:/i))
}

export class ResourcePackageService {
  constructor(
    readonly repository: SqliteMetadataRepository,
    readonly descriptors: ResourceDescriptorService = new ResourceDescriptorService(),
  ) {}

  async importDirectory(projectId: ProjectId, input: ImportDirectoryInput): Promise<ResourcePackageOutcome> {
    const project = this.repository.getProject(String(projectId))
    if (project === undefined) throw new Error('Project not found.')
    if (input.rootName.trim() === '' || input.rootName.length > 160) throw new Error('rootName is required (max 160 chars).')
    if (input.files.length === 0) throw new Error('Directory has no importable files.')
    if (input.files.length > MAX_PACKAGE_FILES) throw new Error(`Directory exceeds the ${MAX_PACKAGE_FILES} file limit.`)
    const identity = packageIdentity(projectId, input.importRequestId)
    const resourceId = `resource-${identity}` as ResourceId
    const rootName = input.rootName.trim()
    const files: Array<{ readonly path: string; readonly bytes: Buffer }> = []
    const normalizedPaths = new Set<string>()
    let totalBytes = 0
    for (const file of input.files) {
      const path = safePackagePath(file.path)
      if (path === undefined) continue
      const collisionKey = path.normalize('NFC').toLocaleLowerCase('en-US')
      if (normalizedPaths.has(collisionKey)) throw new Error(`Duplicate normalized package path: ${file.path}`)
      normalizedPaths.add(collisionKey)
      if (file.bytes.byteLength > MAX_PACKAGE_SINGLE_BYTES) {
        throw new Error(`File exceeds the per-file limit: ${file.path}`)
      }
      totalBytes += file.bytes.byteLength
      if (totalBytes > MAX_PACKAGE_TOTAL_BYTES) throw new Error('Directory exceeds the total size limit.')
      files.push({ path, bytes: file.bytes })
    }
    if (files.length === 0) throw new Error('Directory has no importable files after security filtering.')
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
    const fingerprint = packageFingerprint(rootName, files)

    const ids = {
      fileRecordId: `import-file-${identity}` as FileRecord['id'],
      artifactId: `import-artifact-${identity}` as Artifact['id'],
      revisionId: `import-revision-${identity}` as ArtifactRevision['id'],
      viewId: `import-view-${identity}` as ArtifactView['id'],
    }
    const existingView = this.repository.getArtifactView(String(ids.viewId))
    const existingArtifact = this.repository.getArtifact(String(ids.artifactId))
    const existingRevision = this.repository.getArtifactRevision(String(ids.revisionId))
    const existingFileRecord = this.repository.getFileRecord(String(ids.fileRecordId))
    if (existingView !== undefined && existingArtifact !== undefined && existingRevision !== undefined && existingFileRecord !== undefined) {
      let existingFingerprint: string | undefined
      try {
        const manifest = JSON.parse(await readFile(existingFileRecord.observedPath, 'utf8')) as { packageFingerprint?: string }
        existingFingerprint = manifest.packageFingerprint
      } catch {}
      const compatible = String(existingArtifact.projectId) === String(projectId)
        && existingArtifact.title === rootName && existingFingerprint === fingerprint
      if (!compatible) throw new ResourcePackageConflictError('importRequestId was already used with different package content.')
      const descriptor = this.repository.getResourceDescriptorByResourceId(String(projectId), resourceId)
      return {
        resourceId,
        artifactId: String(ids.artifactId),
        revisionId: String(ids.revisionId),
        viewId: String(ids.viewId),
        sourceKind: 'directory_copy',
        understandingStatus: (descriptor?.understanding.status ?? 'pending') as ResourceUnderstandingStatus,
        ...(descriptor === undefined ? {} : { descriptor }),
        fileRecord: existingFileRecord,
        artifact: existingArtifact,
        revision: existingRevision,
        view: existingView,
        reused: true,
      }
    }

    const packageRoot = resolve(project.rootPath, 'imports', 'resources', resourceId)
    const sourceRoot = resolve(packageRoot, 'source')
    if (!isInsideDirectory(resolve(project.rootPath, 'imports'), packageRoot)) throw new Error('Package root escaped imports directory.')
    await mkdir(sourceRoot, { recursive: true })
    const manifestEntries: ManifestEntry[] = []
    try {
      for (const file of files) {
        const finalPath = resolve(sourceRoot, file.path)
        if (!isInsideDirectory(sourceRoot, finalPath)) throw new Error('Package file escaped its source root.')
        const tempPath = `${finalPath}.tmp`
        await mkdir(dirname(finalPath), { recursive: true })
        await writeFile(tempPath, file.bytes, { flag: 'w' })
        await rename(tempPath, finalPath)
        const fileStat = await stat(finalPath)
        manifestEntries.push({
          path: file.path,
          size: fileStat.size,
          contentHash: createHash('sha256').update(file.bytes).digest('hex'),
        })
      }
      const manifest: { schemaVersion: '0'; resourceId: string; rootName: string; packageFingerprint: string; files: readonly ManifestEntry[] } = {
        schemaVersion: '0',
        resourceId,
        rootName,
        packageFingerprint: fingerprint,
        files: manifestEntries,
      }
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      const manifestPath = resolve(packageRoot, 'resource-manifest.json')
      await writeFile(`${manifestPath}.tmp`, manifestBytes, { flag: 'w' })
      await rename(`${manifestPath}.tmp`, manifestPath)

      const now = new Date().toISOString()
      const manifestHash = createHash('sha256').update(manifestBytes).digest('hex')
      const fileRecord: FileRecord = {
        id: ids.fileRecordId,
        projectId,
        observedPath: manifestPath,
        observedHash: manifestHash as FileRecord['observedHash'],
        size: manifestBytes.byteLength,
        modifiedAt: now,
        mimeType: 'application/vnd.lcos.resource-package',
        availability: 'current',
        observedAt: now,
      }
      const artifact: Artifact = {
        id: ids.artifactId,
        projectId,
        title: rootName,
        kind: 'other',
        availability: 'available',
        currentRevisionId: ids.revisionId,
        createdAt: now,
        updatedAt: now,
      }
      const revision: ArtifactRevision = {
        id: ids.revisionId,
        artifactId: ids.artifactId,
        fileRecordId: ids.fileRecordId,
        contentHash: manifestHash as ArtifactRevision['contentHash'],
        source: 'import',
        status: 'current',
        createdAt: now,
      }
      const view: ArtifactView = {
        id: ids.viewId,
        artifactId: ids.artifactId,
        scopeId: input.scopeId as ScopeId,
        revisionId: ids.revisionId,
        referenceKind: 'primary',
        position: input.position,
        size: { width: 240, height: 170 },
        displayMode: 'card',
        collapsed: false,
      }
      this.repository.registerImportedSource(fileRecord, artifact, revision, view)
      const fast = this.descriptors.buildFastDescriptor({
        projectId: String(projectId),
        resourceId,
        artifactId: String(ids.artifactId),
        revisionId: String(ids.revisionId),
        title: rootName,
        sourceKind: 'directory',
        originalName: rootName,
        mediaType: 'application/vnd.lcos.resource-package',
        contentHash: manifestHash,
        ...(input.userNote === undefined ? {} : { userNote: input.userNote }),
      })
      this.repository.createResourceDescriptorPending(fast)
      return {
        resourceId,
        artifactId: String(ids.artifactId),
        revisionId: String(ids.revisionId),
        viewId: String(ids.viewId),
        sourceKind: 'directory_copy',
        understandingStatus: 'pending',
        descriptor: fast,
        fileRecord,
        artifact,
        revision,
        view,
        reused: false,
      }
    } catch (error: unknown) {
      await rm(packageRoot, { recursive: true, force: true })
      throw error
    }
  }

  async importArchive(projectId: ProjectId, input: ImportArchiveInput): Promise<ResourcePackageOutcome> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PACKAGE_TOTAL_BYTES) {
      throw new ZipReadError('Archive is empty or exceeds the size limit.')
    }
    const entries = readZipArchive(input.bytes)
    const rootName = input.fileName.replace(/\.zip$/i, '') || 'archive'
    return this.importDirectory(projectId, {
      importRequestId: input.importRequestId,
      rootName,
      files: entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
      scopeId: input.scopeId,
      position: input.position,
      ...(input.userNote === undefined ? {} : { userNote: input.userNote }),
    })
  }

  resolveManifestFiles(descriptor: ResourceDescriptorV0, manifestText: string): readonly { path: string; size: number; contentHash: string }[] {
    const parsed = JSON.parse(manifestText) as { schemaVersion?: string; files?: readonly ManifestEntry[] }
    if (parsed.schemaVersion !== '0' || !Array.isArray(parsed.files)) throw new Error('Invalid resource manifest.')
    return parsed.files
  }

  extensionHint(path: string): string {
    return extname(path).toLocaleLowerCase('en-US')
  }
}
