import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  Artifact,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactView,
  Checkpoint,
  ContentHash,
  FileRecord,
  Project,
  ProjectId,
  Relation,
  Scope,
  ScopeId,
  Workspace,
} from '@local-creative-os/domain'
import type { ProjectGraphSnapshot } from '@local-creative-os/contracts'

import { SqliteMetadataRepository } from './metadata-repository.js'

export const MVP_SAMPLE_PROJECT_ID = 'disposable-mvp-sample' as ProjectId

const SAMPLE_MARKDOWN_BRIEF = `# PortaSplit MVP Brief

Goal: show a local creative project as a persistent Canvas, not a throwaway frontend fixture.

Audience: a small product team reviewing brief, script, reference and feedback before handoff.

Success:
- Source files have stable FileRecord identity.
- Canvas restores after Local Core restart.
- Reference and feedback are visible as project context.
`

const SAMPLE_SCRIPT = `PortaSplit demo script

1. Open the MVP sample project.
2. Review the brief, script and visual reference.
3. Check feedback notes and file identity.
4. Generate a handoff pack after the review pass.
`

const SAMPLE_FEEDBACK = `# Feedback

- Keep the MVP path focused on project understanding and handoff.
- Do not treat Bridge execution as connected until the reality gate is approved.
- Make Fixture/Demo state visibly different from Runtime state.
`

const SAMPLE_REFERENCE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAlklEQVR4nO3QMQ6AIBAEwPz/0zV2YkbUaCBwsbNkszsz8B0O4K7uqZ7nDgB8oAAKIAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoAAKoABuWwH8XQG3Wv2uCwAAAABJRU5ErkJggg=='

interface SampleFile {
  readonly id: string
  readonly title: string
  readonly kind: Artifact['kind']
  readonly relativePath: string
  readonly mimeType: string
  readonly bytes: Buffer
}

function now(): string {
  return new Date().toISOString()
}

function hash(bytes: Buffer): ContentHash {
  return createHash('sha256').update(bytes).digest('hex') as ContentHash
}

function writeSampleFiles(sampleRoot: string): readonly (SampleFile & { readonly absolutePath: string; readonly contentHash: ContentHash; readonly size: number; readonly modifiedAt: string })[] {
  mkdirSync(sampleRoot, { recursive: true })
  const files: readonly SampleFile[] = [
    {
      id: 'brief',
      title: 'Brief',
      kind: 'markdown',
      relativePath: 'brief.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from(SAMPLE_MARKDOWN_BRIEF, 'utf8'),
    },
    {
      id: 'script',
      title: 'Script',
      kind: 'markdown',
      relativePath: 'script.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from(SAMPLE_SCRIPT, 'utf8'),
    },
    {
      id: 'reference',
      title: 'Reference Image',
      kind: 'image',
      relativePath: 'reference.png',
      mimeType: 'image/png',
      bytes: Buffer.from(SAMPLE_REFERENCE_PNG_BASE64, 'base64'),
    },
    {
      id: 'feedback',
      title: 'Feedback Notes',
      kind: 'markdown',
      relativePath: 'feedback.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from(SAMPLE_FEEDBACK, 'utf8'),
    },
  ]
  return files.map((file) => {
    const absolutePath = join(sampleRoot, file.relativePath)
    writeFileSync(absolutePath, file.bytes)
    const stat = statSync(absolutePath)
    return {
      ...file,
      absolutePath,
      contentHash: hash(file.bytes),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    }
  })
}

export function createMvpSampleSnapshot(sampleRoot: string, createdAt = now()): ProjectGraphSnapshot {
  const sampleFiles = writeSampleFiles(sampleRoot)
  const project: Project = {
    id: MVP_SAMPLE_PROJECT_ID,
    name: 'LCOS MVP Sample',
    rootPath: sampleRoot,
    graphVersion: 1 as Project['graphVersion'],
    createdAt,
    updatedAt: createdAt,
  }
  const scopeId = 'scope-mvp-root' as ScopeId
  const scope: Scope = {
    id: scopeId,
    projectId: project.id,
    parentScopeId: null,
    containerViewId: null,
    kind: 'root',
    name: 'MVP Root',
    createdAt,
    updatedAt: createdAt,
  }
  const workspaces: readonly Workspace[] = [
    {
      id: 'workspace-brief-script' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: 'Brief / Script',
      intent: 'understand',
      viewport: { x: 120, y: 80, zoom: 0.82 },
      focusedViewIds: ['view-brief', 'view-script'].map((id) => id as ArtifactView['id']),
      visibleLayers: ['core', 'process'],
      contextPolicy: 'workspace-related',
      updatedAt: createdAt,
    },
    {
      id: 'workspace-reference-feedback' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: 'Reference / Feedback',
      intent: 'explore',
      viewport: { x: -160, y: 40, zoom: 0.78 },
      focusedViewIds: ['view-reference', 'view-feedback'].map((id) => id as ArtifactView['id']),
      visibleLayers: ['core', 'process'],
      contextPolicy: 'workspace-related',
      updatedAt: createdAt,
    },
    {
      id: 'workspace-handoff-review' as Workspace['id'],
      projectId: project.id,
      scopeId,
      name: 'Handoff Review',
      intent: 'decide',
      viewport: { x: -40, y: -60, zoom: 0.72 },
      focusedViewIds: ['view-brief', 'view-script', 'view-feedback'].map((id) => id as ArtifactView['id']),
      visibleLayers: ['core', 'process'],
      contextPolicy: 'selection-only',
      updatedAt: createdAt,
    },
  ]

  const fileRecords: FileRecord[] = sampleFiles.map((file) => ({
    id: `file-${file.id}` as FileRecord['id'],
    projectId: project.id,
    observedPath: file.absolutePath,
    observedHash: file.contentHash,
    size: file.size,
    modifiedAt: file.modifiedAt,
    mimeType: file.mimeType,
    availability: 'current',
    observedAt: createdAt,
  }))
  const artifactRevisions: ArtifactRevision[] = sampleFiles.map((file) => ({
    id: `revision-${file.id}-initial` as ArtifactRevisionId,
    artifactId: `artifact-${file.id}` as Artifact['id'],
    fileRecordId: `file-${file.id}` as FileRecord['id'],
    contentHash: file.contentHash,
    source: 'import',
    status: 'current',
    createdAt,
  }))
  const artifacts: Artifact[] = sampleFiles.map((file) => ({
    id: `artifact-${file.id}` as Artifact['id'],
    projectId: project.id,
    title: file.title,
    kind: file.kind,
    availability: 'available',
    currentRevisionId: `revision-${file.id}-initial` as ArtifactRevisionId,
    createdAt,
    updatedAt: createdAt,
  }))
  const artifactViews: ArtifactView[] = [
    { id: 'view-brief' as ArtifactView['id'], artifactId: 'artifact-brief' as Artifact['id'], revisionId: 'revision-brief-initial' as ArtifactRevisionId, scopeId, referenceKind: 'primary', position: { x: 0, y: 0 }, size: { width: 280, height: 190 }, displayMode: 'card', collapsed: false },
    { id: 'view-script' as ArtifactView['id'], artifactId: 'artifact-script' as Artifact['id'], revisionId: 'revision-script-initial' as ArtifactRevisionId, scopeId, referenceKind: 'primary', position: { x: 360, y: 20 }, size: { width: 300, height: 210 }, displayMode: 'card', collapsed: false },
    { id: 'view-reference' as ArtifactView['id'], artifactId: 'artifact-reference' as Artifact['id'], revisionId: 'revision-reference-initial' as ArtifactRevisionId, scopeId, referenceKind: 'primary', position: { x: 70, y: 280 }, size: { width: 240, height: 190 }, displayMode: 'thumbnail', collapsed: false },
    { id: 'view-feedback' as ArtifactView['id'], artifactId: 'artifact-feedback' as Artifact['id'], revisionId: 'revision-feedback-initial' as ArtifactRevisionId, scopeId, referenceKind: 'primary', position: { x: 390, y: 300 }, size: { width: 270, height: 180 }, displayMode: 'card', collapsed: false },
  ]
  const relation = (id: string, source: string, target: string, kind: string): Relation => ({
    id: id as Relation['id'],
    projectId: project.id,
    sourceEntityType: 'artifact',
    sourceEntityId: source,
    targetEntityType: 'artifact',
    targetEntityId: target,
    kind,
    createdAt,
    updatedAt: createdAt,
  })
  const checkpoint: Checkpoint = {
    id: 'checkpoint-mvp-sample-start' as Checkpoint['id'],
    projectId: project.id,
    scopeId,
    label: 'MVP sample start',
    snapshotJson: {
      projectId: String(project.id),
      workspaceIds: workspaces.map((workspace) => String(workspace.id)),
      artifactIds: artifacts.map((artifact) => String(artifact.id)),
      note: 'Initial real Runtime sample project.',
    },
    createdAt,
  }
  return {
    schemaVersion: 7,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project,
    scopes: [scope],
    workspaces,
    artifacts,
    artifactViews,
    relations: [
      relation('relation-brief-script', 'artifact-brief', 'artifact-script', 'informs'),
      relation('relation-reference-brief', 'artifact-reference', 'artifact-brief', 'reference'),
      relation('relation-feedback-script', 'artifact-feedback', 'artifact-script', 'feedback'),
    ],
    notes: [
      { id: 'note-project-mvp-boundary' as ProjectGraphSnapshot['notes'][number]['id'], projectId: project.id, anchor: { type: 'project' }, body: 'MVP sample is Runtime-backed. Bridge execution remains outside the core path.', createdAt, updatedAt: createdAt },
      { id: 'note-feedback-view' as ProjectGraphSnapshot['notes'][number]['id'], projectId: project.id, anchor: { type: 'artifact_view', viewId: 'view-feedback' as ArtifactView['id'] }, body: 'Use this as explicit Feedback context, not as an AI return.', createdAt, updatedAt: createdAt },
    ],
    artifactRevisions,
    fileRecords,
    checkpoints: [checkpoint],
  }
}

export function ensureMvpSampleProject(repository: SqliteMetadataRepository, sampleRoot: string): boolean {
  if (repository.getProject(String(MVP_SAMPLE_PROJECT_ID)) !== undefined) return false
  repository.save(createMvpSampleSnapshot(sampleRoot))
  return true
}
