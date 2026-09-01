import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { Artifact, ArtifactRevision, ArtifactView, FileRecord } from '@local-creative-os/domain'
import { artifactKindForFile, mimeTypeForFile } from './file-format-registry.js'
import { hashFileSha256 } from './file-registry-service.js'

const EXCLUDED_DIRECTORIES = new Set(['.creative-os', '.git', '.svn', 'node_modules'])
const MAX_FILES = 2_000
const MAX_DEPTH = 20

export interface ProjectRootInspection {
  readonly fileCount: number
  readonly directoryCount: number
  readonly totalBytes: number
  readonly skipped: readonly string[]
  readonly requiresConfirmation: boolean
}

interface ScannedFile { readonly absolutePath: string; readonly relativePath: string; readonly size: number; readonly modifiedAt: string }
interface ScanResult { readonly inspection: ProjectRootInspection; readonly files: readonly ScannedFile[]; readonly directories: readonly string[] }

function stableId(prefix: string, projectId: string, relativePath: string): string {
  return `${prefix}-${createHash('sha256').update(projectId).update('\0').update(relativePath).digest('hex').slice(0, 24)}`
}

async function scan(rootPath: string, signal?: AbortSignal): Promise<ScanResult> {
  const root = resolve(rootPath)
  const files: ScannedFile[] = []
  const directories: string[] = []
  const skipped: string[] = []
  let totalBytes = 0
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (signal?.aborted) throw new DOMException('Project scan aborted.', 'AbortError')
    if (depth > MAX_DEPTH) { skipped.push(`${relative(root, folder)} (depth limit)`); return }
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const absolutePath = resolve(folder, entry.name)
      const relativePath = relative(root, absolutePath).replace(/\\/g, '/')
      if (entry.isSymbolicLink()) { skipped.push(`${relativePath} (symbolic link)`); continue }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) { skipped.push(`${relativePath}/ (internal directory)`); continue }
        directories.push(relativePath)
        await walk(absolutePath, depth + 1)
        continue
      }
      if (!entry.isFile()) { skipped.push(`${relativePath} (unsupported entry)`); continue }
      if (files.length >= MAX_FILES) throw new Error(`Project contains more than ${MAX_FILES} files; narrow the selected root before importing.`)
      const details = await stat(absolutePath)
      totalBytes += details.size
      files.push({ absolutePath, relativePath, size: details.size, modifiedAt: details.mtime.toISOString() })
    }
  }
  await walk(root, 0)
  return {
    files,
    directories,
    inspection: { fileCount: files.length, directoryCount: directories.length, totalBytes, skipped, requiresConfirmation: files.length > 0 || directories.length > 0 },
  }
}

export async function inspectProjectRoot(rootPath: string, signal?: AbortSignal): Promise<ProjectRootInspection> {
  return (await scan(rootPath, signal)).inspection
}

export async function indexProjectRoot(snapshot: ProjectGraphSnapshot, signal?: AbortSignal): Promise<ProjectGraphSnapshot> {
  const scanned = await scan(snapshot.project.rootPath, signal)
  if (!scanned.inspection.requiresConfirmation) return snapshot
  const now = new Date().toISOString()
  const projectId = String(snapshot.project.id)
  const rootScope = snapshot.scopes.find((scope) => scope.kind === 'root') ?? snapshot.scopes[0]
  if (rootScope === undefined) throw new Error('Project root scope is missing.')
  // B-stage convergence: the selected folder is provenance, not LCOS ontology.
  // Import every real file into the project root first. Directory names remain
  // available through FileRecord.observedPath and may inform a later Agent
  // Proposal, but they do not silently become Collection / Workspace truth.
  const artifacts: Artifact[] = [...snapshot.artifacts]
  const views: ArtifactView[] = [...snapshot.artifactViews]
  const fileRecords: FileRecord[] = [...snapshot.fileRecords]
  const revisions: ArtifactRevision[] = [...snapshot.artifactRevisions]

  const filesByDirectory = new Map<string, ScannedFile[]>()
  for (const file of scanned.files) {
    const directory = file.relativePath.includes('/') ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/')) : ''
    const group = filesByDirectory.get(directory) ?? []
    group.push(file)
    filesByDirectory.set(directory, group)
  }

  let groupRowOffset = 0
  for (const [directory, groupFiles] of [...filesByDirectory.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const sortedFiles = [...groupFiles].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    for (const [itemIndex, file] of sortedFiles.entries()) {
      const fileRecordId = stableId('root-file', projectId, file.relativePath) as FileRecord['id']
      const artifactId = stableId('root-artifact', projectId, file.relativePath) as Artifact['id']
      const revisionId = stableId('root-revision', projectId, file.relativePath) as ArtifactRevision['id']
      const viewId = stableId('root-view', projectId, file.relativePath) as ArtifactView['id']
      const observedHash = await hashFileSha256(file.absolutePath, signal) as FileRecord['observedHash']
      const mimeType = mimeTypeForFile(file.absolutePath)
      const kind = artifactKindForFile(file.absolutePath, mimeType)
      fileRecords.push({ id: fileRecordId, projectId: snapshot.project.id, observedPath: file.absolutePath, observedHash, size: file.size, modifiedAt: file.modifiedAt, mimeType, availability: 'current', observedAt: now })
      revisions.push({ id: revisionId, artifactId, fileRecordId, contentHash: observedHash, source: 'import', status: 'current', createdAt: now })
      artifacts.push({ id: artifactId, projectId: snapshot.project.id, title: basename(file.relativePath), kind, availability: 'available', currentRevisionId: revisionId, createdAt: now, updatedAt: now })
      views.push({
        id: viewId,
        artifactId,
        scopeId: rootScope.id as ArtifactView['scopeId'],
        revisionId,
        referenceKind: 'primary',
        position: { x: 80 + (itemIndex % 4) * 260, y: 80 + (groupRowOffset + Math.floor(itemIndex / 4)) * 190 },
        size: kind === 'image' ? { width: 220, height: 300 } : { width: 220, height: 150 },
        displayMode: kind === 'image' ? 'thumbnail' : 'card',
        collapsed: false,
      })
    }
    // Keep a visual gap between source-directory batches without converting
    // the directory into structural containment.
    groupRowOffset += Math.max(1, Math.ceil(sortedFiles.length / 4) + (directory ? 1 : 0))
  }
  return { ...snapshot, artifacts, artifactViews: views, fileRecords, artifactRevisions: revisions }
}
