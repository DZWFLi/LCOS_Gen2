import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'

import type { RunInputRequestV1, RuntimePersistenceContract } from '@local-creative-os/contracts'
import type {
  Artifact,
  ArtifactReturn,
  ArtifactRevision,
  ContentHash,
  FileRecord,
  Run,
  RunId,
} from '@local-creative-os/domain'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  RuntimeInputPackV0,
  RuntimeProjectReader,
} from './runtime-adapter.js'
import { RuntimeAdapterError } from './runtime-adapter.js'

export interface RuntimeResultRepository extends RuntimePersistenceContract, RuntimeProjectReader {
  getArtifact(artifactId: string): Artifact | undefined
  getArtifactRevision(revisionId: string): ArtifactRevision | undefined
  getFileRecord(fileRecordId: string): FileRecord | undefined
  createRuntimeCreatedArtifact(
    fileRecord: FileRecord,
    artifact: Artifact,
    revision: ArtifactRevision,
    artifactReturn: ArtifactReturn,
  ): ArtifactReturn
  saveRunInputRequest(value: RunInputRequestV1): void
  updateRunOutcome(
    runId: RunId,
    input: {
      readonly status: Run['status']
      readonly resultSummary?: string
      readonly shortSummary?: string
      readonly errorCode?: string
      readonly errorMessage?: string
      readonly completedAt?: string
    },
    updatedAt: string,
  ): Run
}

export type IngestedRuntimeResult =
  | {
      readonly kind: 'revise'
      readonly artifactReturn: ArtifactReturn
      readonly draftRevision: ArtifactRevision
      readonly fileRecord: FileRecord
      readonly baseStale: boolean
      readonly replayed: boolean
    }
  | {
      readonly kind: 'analyze'
      readonly summary: string
    }
  | {
      readonly kind: 'waiting_input'
      readonly inputRequest: RunInputRequestV1
    }
  | {
      readonly kind: 'create'
      readonly artifactReturns: readonly ArtifactReturn[]
    }

function kindForExtension(extension: string): Artifact['kind'] {
  if (extension === '.md' || extension === '.txt') return 'markdown'
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return 'image'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.ppt' || extension === '.pptx') return 'presentation'
  return 'other'
}

function mimeForExtension(extension: string): string {
  if (extension === '.md') return 'text/markdown'
  if (extension === '.txt') return 'text/plain'
  if (extension === '.json') return 'application/json'
  if (extension === '.yaml' || extension === '.yml') return 'application/yaml'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

function error(code: string, message: string, retryable = false): RuntimeAdapterError {
  return new RuntimeAdapterError({ code, message, retryable, provider: 'workbuddy' })
}

function assertContained(root: string, candidate: string, code = 'RESULT_PATH_REJECTED'): void {
  const pathFromRoot = relative(root, candidate)
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw error(code, 'Result path escapes the allowed Runtime staging root.')
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function archiveEvidence(path: string, envelope: BridgeResultEnvelopeV0): Promise<void> {
  const content = `${canonicalJson(envelope)}\n`
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (caught: unknown) {
    const code = caught instanceof Error && 'code' in caught ? String(caught.code) : ''
    if (code !== 'EEXIST') throw caught
    const existing = await readFile(path, 'utf8')
    let existingEnvelope: BridgeResultEnvelopeV0 | undefined
    try {
      existingEnvelope = JSON.parse(existing) as BridgeResultEnvelopeV0
    } catch {
      // The conflict below reports malformed or incompatible evidence uniformly.
    }
    const sameExecutionEvidence = existingEnvelope !== undefined
      && existingEnvelope.contractVersion === envelope.contractVersion
      && existingEnvelope.taskId === envelope.taskId
      && existingEnvelope.lcosRunId === envelope.lcosRunId
      && existingEnvelope.providerStatus === envelope.providerStatus
      && canonicalJson(existingEnvelope.changedFiles) === canonicalJson(envelope.changedFiles)
      && canonicalJson(existingEnvelope.inputRequest) === canonicalJson(envelope.inputRequest)
    if (!sameExecutionEvidence) {
      throw error('RESULT_EVIDENCE_CONFLICT', 'ResultEnvelope evidence is immutable and conflicts with stored evidence.')
    }
  }
}

function validateEnvelope(envelope: BridgeResultEnvelopeV0, run: Run, taskId: string): void {
  if (
    !['bridge-result-v0', 'bridge-result-v1'].includes(envelope.contractVersion)
    || envelope.lcosRunId !== String(run.id)
    || envelope.taskId !== taskId
  ) {
    throw error('CONTRACT_UNSUPPORTED', 'ResultEnvelope identity does not match the RuntimeBinding.')
  }
  if (!['review', 'waiting_input', 'failed', 'cancelled', 'timeout'].includes(envelope.providerStatus)) {
    throw error('CONTRACT_UNSUPPORTED', 'ResultEnvelope provider status is unsupported.')
  }
}

export class RuntimeResultIngestionService {
  constructor(
    private readonly repository: RuntimeResultRepository,
    private readonly bridge: BridgeRuntimePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async ingestFromBridge(runId: RunId): Promise<IngestedRuntimeResult | undefined> {
    const binding = this.repository.getRuntimeBinding(runId)
    if (binding?.externalTaskId === undefined) {
      throw error('TASK_NOT_FOUND', 'RuntimeBinding has no external Bridge Task.')
    }
    const envelope = await this.bridge.getResult(binding.externalTaskId, String(runId))
    if (envelope === undefined) return undefined
    return this.ingest(envelope)
  }

  async ingest(envelope: BridgeResultEnvelopeV0): Promise<IngestedRuntimeResult> {
    const run = this.repository.getRun(envelope.lcosRunId as RunId)
    if (run === undefined) throw error('TASK_NOT_FOUND', 'Canonical Run was not found.')
    const binding = this.repository.getRuntimeBinding(run.id)
    if (binding?.externalTaskId === undefined) throw error('TASK_NOT_FOUND', 'RuntimeBinding was not found.')
    validateEnvelope(envelope, run, binding.externalTaskId)

    const project = this.repository.getProject(String(run.projectId))
    if (project === undefined) throw error('RUNTIME_STORAGE_CORRUPT', 'Project was not found.')
    const runtimeRoot = resolve(project.rootPath, '.creative-os', 'runtime', String(run.id))
    const packPath = resolve(runtimeRoot, 'runtime-input-pack.json')
    const pack = JSON.parse(await readFile(packPath, 'utf8')) as RuntimeInputPackV0
    const inputRequestEvidenceId = envelope.inputRequest?.requestId === undefined
      ? 'unknown'
      : createHash('sha256').update(envelope.inputRequest.requestId, 'utf8').digest('hex').slice(0, 32)
    const evidencePath = envelope.providerStatus === 'waiting_input'
      ? resolve(runtimeRoot, 'result', `input-request-${inputRequestEvidenceId}.json`)
      : resolve(runtimeRoot, 'result', 'result-envelope-v0.json')
    const canonicalProjectRoot = await realpath(project.rootPath)
    const canonicalRuntimeRoot = await realpath(runtimeRoot)
    const canonicalResultRoot = await realpath(resolve(runtimeRoot, 'result'))
    assertContained(canonicalProjectRoot, canonicalRuntimeRoot)
    assertContained(canonicalRuntimeRoot, canonicalResultRoot)
    try {
      assertContained(canonicalResultRoot, await realpath(evidencePath))
    } catch (caught: unknown) {
      const code = caught instanceof Error && 'code' in caught ? String(caught.code) : ''
      if (code !== 'ENOENT') throw caught
    }
    await archiveEvidence(evidencePath, envelope)

    const syncedAt = this.now()
    this.repository.updateRuntimeBinding({
      ...binding,
      providerStatus: envelope.providerStatus,
      lastSyncedAt: syncedAt,
      updatedAt: syncedAt,
    })

    if (run.status === 'cancelled') {
      throw error('LATE_RESULT_AFTER_CANCEL', 'Cancelled Run result was archived but cannot create a Draft.')
    }
    if (envelope.providerStatus === 'waiting_input') {
      const request = envelope.inputRequest
      if (request === undefined) {
        throw error('CONTRACT_UNSUPPORTED', 'waiting_input requires an inputRequest payload.')
      }
      const inputRequest: RunInputRequestV1 = {
        schemaVersion: 1,
        requestId: request.requestId,
        runId: String(run.id),
        question: request.question,
        options: request.options,
        allowFreeText: request.allowFreeText,
        ...(request.contextVersion === undefined ? {} : { contextVersion: request.contextVersion }),
        status: 'pending',
        selectedOptions: [],
        createdAt: request.createdAt ?? syncedAt,
      }
      this.repository.saveRunInputRequest(inputRequest)
      this.repository.updateRunOutcome(run.id, {
        status: 'waiting_input',
        resultSummary: request.question,
        shortSummary: '需要你补充一点信息',
      }, syncedAt)
      return { kind: 'waiting_input', inputRequest }
    }
    if (envelope.providerStatus !== 'review') {
      const code = envelope.providerStatus === 'timeout'
        ? 'PROVIDER_TIMEOUT'
        : envelope.providerStatus === 'cancelled'
          ? 'PROVIDER_CANCELLED'
          : 'PROVIDER_FAILED'
      const message = envelope.summary ?? envelope.shortSummary ?? envelope.resultSummary ?? 'Provider did not return a reviewable result.'
      const status = envelope.providerStatus === 'cancelled' ? 'cancelled' : 'failed'
      this.repository.updateRunOutcome(run.id, {
        status,
        shortSummary: message.slice(0, 180),
        errorCode: code,
        errorMessage: message,
        completedAt: syncedAt,
      }, syncedAt)
      throw error(code, message)
    }
    if (run.outputIntent === 'analyze') {
      if (envelope.changedFiles.length !== 0) {
        throw error('CONTRACT_UNSUPPORTED', 'Analyze runs must return zero changed files; provider returned file changes.')
      }
      const summary = envelope.summary ?? envelope.resultSummary ?? envelope.shortSummary ?? 'Analysis completed with no file changes.'
      this.repository.updateRunOutcome(run.id, {
        status: 'completed',
        resultSummary: summary,
        shortSummary: envelope.shortSummary ?? summary.slice(0, 180),
        completedAt: syncedAt,
      }, syncedAt)
      return {
        kind: 'analyze',
        summary,
      }
    }
    if (run.outputIntent === 'create') {
      if (envelope.changedFiles.length < 1 || envelope.changedFiles.length > 5) {
        throw error('CONTRACT_UNSUPPORTED', 'Create runs must return between 1 and 5 changed files.')
      }
      const stagingRoot = await realpath(resolve(runtimeRoot, 'staging'))
      assertContained(canonicalRuntimeRoot, stagingRoot)
      const artifactReturns: ArtifactReturn[] = []
      for (const changedFile of envelope.changedFiles) {
        if (changedFile.action !== 'created') {
          throw error('CONTRACT_UNSUPPORTED', 'Create returns must declare created files only.')
        }
        const declaredPath = changedFile.path
        if (!isAbsolute(declaredPath)) throw error('RESULT_PATH_REJECTED', 'Result path must be absolute.')
        const canonicalPath = await realpath(declaredPath)
        assertContained(stagingRoot, canonicalPath, 'RESULT_PATH_REJECTED')
        const outputStat = await stat(canonicalPath)
        if (!outputStat.isFile()) throw error('RESULT_PATH_REJECTED', 'Result output is not a regular file.')
        const contentHash = createHash('sha256')
          .update(await readFile(canonicalPath))
          .digest('hex') as ContentHash
        const identityHash = createHash('sha256')
          .update(`${String(run.id)}\0${canonicalPath}\0${String(contentHash)}`)
          .digest('hex')
        const existing = this.repository.getArtifactReturnByIdentity(
          run.id,
          canonicalPath,
          String(contentHash),
          'created',
        )
        if (existing !== undefined) {
          artifactReturns.push(existing)
          continue
        }
        const extension = extname(canonicalPath).toLocaleLowerCase('en-US')
        const artifactId = `artifact-created-${identityHash}` as Artifact['id']
        const fileName = basename(canonicalPath)
        const fileRecord: FileRecord = {
          id: `file-created-${identityHash}` as FileRecord['id'],
          projectId: run.projectId,
          observedPath: canonicalPath,
          observedHash: contentHash,
          size: outputStat.size,
          modifiedAt: outputStat.mtime.toISOString(),
          mimeType: mimeForExtension(extension),
          availability: 'current',
          observedAt: syncedAt,
        }
        const artifact: Artifact = {
          id: artifactId,
          projectId: run.projectId,
          title: fileName,
          kind: kindForExtension(extension),
          availability: 'available',
          createdAt: syncedAt,
          updatedAt: syncedAt,
        }
        const draftRevision: ArtifactRevision = {
          id: `revision-created-${identityHash}` as ArtifactRevision['id'],
          artifactId,
          fileRecordId: fileRecord.id,
          contentHash,
          source: 'run',
          runId: run.id,
          status: 'draft',
          createdAt: syncedAt,
        }
        const artifactReturn: ArtifactReturn = {
          id: `return-created-${identityHash}` as ArtifactReturn['id'],
          runId: run.id,
          targetArtifactId: artifactId,
          baseRevisionId: draftRevision.id,
          returnedFileId: fileRecord.id,
          contentHash,
          canonicalPath,
          action: 'created',
          status: 'pending_review',
          draftRevisionId: draftRevision.id,
          createdAt: syncedAt,
          updatedAt: syncedAt,
        }
        artifactReturns.push(
          this.repository.createRuntimeCreatedArtifact(fileRecord, artifact, draftRevision, artifactReturn),
        )
      }
      return { kind: 'create', artifactReturns }
    }
    if (run.outputIntent !== 'revise' || run.targetArtifactId === undefined || run.targetRevisionId === undefined) {
      throw error('CONTRACT_UNSUPPORTED', 'Revise Run requires a target Artifact and Base Revision.')
    }
    const changedFile = envelope.changedFiles[0]
    if (envelope.changedFiles.length !== 1 || changedFile === undefined || !['created', 'modified'].includes(changedFile.action)) {
      throw error('CONTRACT_UNSUPPORTED', 'MVP requires exactly one created or modified changed file.')
    }
    if (pack.lcosRunId !== String(run.id) || pack.expectedOutputs.length !== 1) {
      throw error('RUNTIME_STORAGE_CORRUPT', 'RuntimeInputPack identity or expected outputs are invalid.')
    }

    const declaredPath = changedFile.path
    const expectedPath = pack.expectedOutputs[0]!.absolutePath
    if (!isAbsolute(declaredPath) || resolve(declaredPath) !== resolve(expectedPath)) {
      throw error('RESULT_PATH_REJECTED', 'Result path is not the declared expected output.')
    }
    const stagingRoot = await realpath(resolve(runtimeRoot, 'staging'))
    const canonicalPath = await realpath(declaredPath)
    assertContained(canonicalRuntimeRoot, stagingRoot)
    assertContained(stagingRoot, canonicalPath)
    const outputStat = await stat(canonicalPath)
    if (!outputStat.isFile()) throw error('RESULT_PATH_REJECTED', 'Result output is not a regular file.')
    if (extname(canonicalPath).toLowerCase() !== '.md') {
      throw error('CONTRACT_UNSUPPORTED', 'MVP Runtime result must be Markdown.')
    }

    const contentHash = createHash('sha256')
      .update(await readFile(canonicalPath))
      .digest('hex') as ContentHash
    const identityHash = createHash('sha256')
      .update(`${String(run.id)}\0${canonicalPath}\0${String(contentHash)}`)
      .digest('hex')
    const existing = this.repository.getArtifactReturnByIdentity(
      run.id,
      canonicalPath,
      String(contentHash),
      'created',
    )
    if (existing !== undefined) {
      const draft = existing.draftRevisionId === undefined
        ? undefined
        : this.repository.getArtifactRevision(String(existing.draftRevisionId))
      const file = this.repository.getArtifactRevision(String(existing.draftRevisionId))?.fileRecordId
      const fileRecord = file === undefined ? undefined : this.repository.getFileRecord(String(file))
      if (draft === undefined || fileRecord === undefined) {
        throw error('RUNTIME_STORAGE_CORRUPT', 'Existing ArtifactReturn has incomplete Draft evidence.')
      }
      return {
        kind: 'revise',
        artifactReturn: existing,
        draftRevision: draft,
        fileRecord,
        baseStale: this.isBaseStale(run),
        replayed: true,
      }
    }

    const fileRecord: FileRecord = {
      id: `file-return-${identityHash}` as FileRecord['id'],
      projectId: run.projectId,
      observedPath: canonicalPath,
      observedHash: contentHash,
      size: outputStat.size,
      modifiedAt: outputStat.mtime.toISOString(),
      mimeType: 'text/markdown',
      availability: 'current',
      observedAt: syncedAt,
    }
    const draftRevision: ArtifactRevision = {
      id: `revision-return-${identityHash}` as ArtifactRevision['id'],
      artifactId: run.targetArtifactId,
      fileRecordId: fileRecord.id,
      parentRevisionId: run.targetRevisionId,
      contentHash,
      source: 'run',
      runId: run.id,
      status: 'draft',
      createdAt: syncedAt,
    }
    const artifactReturn: ArtifactReturn = {
      id: `return-${identityHash}` as ArtifactReturn['id'],
      runId: run.id,
      targetArtifactId: run.targetArtifactId,
      baseRevisionId: run.targetRevisionId,
      returnedFileId: fileRecord.id,
      contentHash,
      canonicalPath,
      // Provider V1 calls this a modified logical target. LCOS still receives a
      // newly staged Draft file, so Project Truth records a created return.
      action: 'created',
      status: 'pending_review',
      draftRevisionId: draftRevision.id,
      createdAt: syncedAt,
      updatedAt: syncedAt,
    }
    const persisted = this.repository.createRuntimeDraft(fileRecord, draftRevision, artifactReturn)
    return {
      kind: 'revise',
      artifactReturn: persisted,
      draftRevision,
      fileRecord,
      baseStale: this.isBaseStale(run),
      replayed: false,
    }
  }

  private isBaseStale(run: Run): boolean {
    const artifact = this.repository.getArtifact(String(run.targetArtifactId))
    return artifact?.currentRevisionId === undefined
      || String(artifact.currentRevisionId) !== String(run.targetRevisionId)
  }
}
