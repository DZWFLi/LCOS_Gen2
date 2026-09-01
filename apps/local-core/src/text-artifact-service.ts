import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type {
  Artifact,
  ArtifactRevision,
  ArtifactView,
  ContentHash,
  FileRecord,
  ProjectId,
  ScopeId,
  WorkspaceId,
} from '@local-creative-os/domain'

import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface CreateTextArtifactInput {
  readonly title?: string
  readonly body: string
  readonly scopeId: string
  readonly workspaceId?: string
  readonly x?: number
  readonly y?: number
}

export interface CreateTextArtifactResult {
  readonly artifactId: string
  readonly revisionId: string
  readonly viewId: string
  readonly fileRecordId: string
  readonly title: string
}

export interface ReviseManagedTextResult {
  readonly artifactId: string
  readonly viewId: string
  readonly revisionId: string
  readonly legacyMigrated: boolean
}

/**
 * DZ-RUN-16：文本归一为轻量 Text Artifact（受管 Markdown，带 Revision），
 * 可自然进入 Context / 被 revise，不再是无身份的本地 Note 节点。
 */
/** HU-1: 构造 Text Artifact draft 并写 staged 文件（DB 事务由调用方决定）。 */
export async function buildTextArtifactDraft(
  repository: SqliteMetadataRepository,
  projectId: ProjectId,
  input: CreateTextArtifactInput,
): Promise<{
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly revision: ArtifactRevision
  readonly view: ArtifactView
  readonly stagedPath: string
  readonly finalPath: string
  readonly title: string
  readonly viewId: string
}> {
  const project = repository.getProject(String(projectId))
  if (project === undefined) throw new Error('Project not found.')
  const now = new Date().toISOString()
  const id = `text-${randomUUID()}`
  const title = input.title?.trim() || input.body.split(/\r?\n/)[0]?.trim().slice(0, 80) || '文本'
  const notesDir = resolve(project.rootPath, '.creative-os', 'notes')
  const stagingDir = resolve(project.rootPath, '.creative-os', 'staging')
  await mkdir(stagingDir, { recursive: true })
  // HU-1C: 先写 staged 文件（DB 提交成功后 atomic rename 到最终 immutable path；失败即清理）
  const stagedPath = join(stagingDir, `${id}.md`)
  await writeFile(stagedPath, input.body, 'utf8')
  const info = await stat(stagedPath)
  const contentHash = createHash('sha256').update(input.body, 'utf8').digest('hex') as ContentHash
  const finalPath = join(notesDir, `${id}.md`)

  const fileRecord: FileRecord = {
    id: `file-${id}` as FileRecord['id'],
    projectId,
    observedPath: finalPath,
    observedHash: contentHash,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    mimeType: 'text/markdown',
    availability: 'current',
    observedAt: now,
  }
  const revisionId = `revision-${id}` as ArtifactRevision['id']
  const artifactId = `artifact-${id}` as Artifact['id']
  const artifact: Artifact = {
    id: artifactId,
    projectId,
    title,
    kind: 'markdown',
    managed: true,
    availability: 'available',
    currentRevisionId: revisionId,
    createdAt: now,
    updatedAt: now,
  }
  const revision: ArtifactRevision = {
    id: revisionId,
    artifactId,
    fileRecordId: fileRecord.id,
    contentHash,
    source: 'import',
    status: 'current',
    createdAt: now,
  }
  const viewId = `view-${id}` as ArtifactView['id']
  const view: ArtifactView = {
    id: viewId,
    artifactId,
    scopeId: input.scopeId as ScopeId,
    revisionId,
    referenceKind: 'primary',
    position: { x: input.x ?? 120, y: input.y ?? 120 },
    size: { width: 260, height: 170 },
    displayMode: 'card',
    collapsed: false,
  }
  return { fileRecord, artifact, revision, view, stagedPath, finalPath, title, viewId: String(viewId) }
}

export async function createTextArtifact(
  repository: SqliteMetadataRepository,
  projectId: ProjectId,
  input: CreateTextArtifactInput,
): Promise<CreateTextArtifactResult> {
  const draft = await buildTextArtifactDraft(repository, projectId, input)
  const { fileRecord, artifact, revision, view, stagedPath, finalPath } = draft
  try {
    repository.registerTextArtifactComposite(fileRecord, artifact, revision, view, input.workspaceId === undefined ? undefined : input.workspaceId as WorkspaceId)
  } catch (error: unknown) {
    // DB 失败：删 staged，不留半套
    await rm(stagedPath, { force: true }).catch(() => { /* best effort */ })
    throw error
  }
  try {
    await mkdir(dirname(finalPath), { recursive: true })
    await rename(stagedPath, finalPath)
  } catch {
    // rename 失败（罕见）：DB 已提交，文件留在 staging；启动 sweep 会按 id 归位到 notes。
    console.warn(`[text-artifact] staged file rename deferred: ${stagedPath}`)
  }
  return {
    artifactId: String(draft.artifact.id),
    revisionId: String(draft.revision.id),
    viewId: draft.viewId,
    fileRecordId: String(fileRecord.id),
    title: draft.title,
  }
}

/**
 * Phase E (E3/E4/E5): Curation edit of a managed Text Artifact.
 * - New revision files are immutable: .creative-os/notes/<artifactId>/<revisionId>.md
 * - Legacy notes/text-<uuid>.md is migrated once on first revise (copied to the
 *   immutable layout and the old FileRecord re-pointed)
 * - currentRevisionId switches directly (Curation edit ≠ Managed Run draft)
 */
export async function reviseManagedTextArtifact(
  repository: SqliteMetadataRepository,
  projectId: ProjectId,
  target: { readonly viewId?: string; readonly artifactId?: string },
  body: string,
  options: { readonly title?: string; readonly createdBy?: string } = {},
): Promise<ReviseManagedTextResult> {
  const project = repository.getProject(String(projectId))
  if (project === undefined) throw new Error('Project not found.')
  const artifact = target.artifactId === undefined
    ? (target.viewId === undefined ? undefined : repository.getArtifact(String(repository.getArtifactView(target.viewId)?.artifactId ?? '')))
    : repository.getArtifact(target.artifactId)
  if (artifact === undefined || String(artifact.projectId) !== projectId) throw new Error('Managed text artifact not found.')
  const currentRevisionId = artifact.currentRevisionId
  if (currentRevisionId === undefined) throw new Error('Managed text artifact has no current revision.')
  const previousRevision = repository.getArtifactRevision(currentRevisionId)
  if (previousRevision === undefined) throw new Error('Current revision not found.')
  const previousFileRecord = repository.getFileRecord(String(previousRevision.fileRecordId))
  if (previousFileRecord === undefined) throw new Error('Current revision file record not found.')

  const notesDir = resolve(project.rootPath, '.creative-os', 'notes')
  const artifactDir = join(notesDir, artifact.id)
  await mkdir(artifactDir, { recursive: true })

  const now = new Date().toISOString()
  const revisionId = `revision-text-${randomUUID()}`
  const newPath = join(artifactDir, `${revisionId}.md`)
  const contentHash = createHash('sha256').update(body, 'utf8').digest('hex')
  await writeFile(newPath, body, 'utf8')

  let legacyMigrated = false
  const previousPath = previousFileRecord.observedPath
  const previousIsLegacy = basename(dirname(previousPath)) === 'notes'
    || (!previousPath.includes(join('notes', artifact.id)) && basename(previousPath).startsWith('text-'))
  if (previousIsLegacy) {
    const legacyRevisionPath = join(artifactDir, `${String(previousRevision.id)}.md`)
    await copyFile(previousPath, legacyRevisionPath)
    repository.upsertFileRecord({
      ...previousFileRecord,
      observedPath: legacyRevisionPath,
      observedAt: now,
    })
    legacyMigrated = true
  }

  const newFileRecord: FileRecord = {
    id: `file-text-${randomUUID()}` as FileRecord['id'],
    projectId,
    observedPath: newPath,
    observedHash: contentHash as FileRecord['observedHash'],
    size: Buffer.byteLength(body, 'utf8'),
    modifiedAt: now,
    mimeType: 'text/markdown' as const,
    availability: 'current' as const,
    observedAt: now,
  }
  const newRevision: ArtifactRevision = {
    id: revisionId as ArtifactRevision['id'],
    artifactId: artifact.id,
    fileRecordId: newFileRecord.id,
    parentRevisionId: previousRevision.id,
    contentHash: contentHash as ArtifactRevision['contentHash'],
    source: 'external' as const,
    status: 'current' as const,
    createdAt: now,
  }
  repository.commitManagedTextRevision({
    artifact,
    previousRevision,
    newFileRecord,
    newRevision,
  })
  const view = target.viewId
    ?? repository.getArtifactViews(String(artifact.id))[0]?.id
  return { artifactId: artifact.id, viewId: view ?? '', revisionId, legacyMigrated }
}
