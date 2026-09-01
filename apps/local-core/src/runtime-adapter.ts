import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type {
  CompiledContextPromptV1,
  ContextCacheTelemetryV1,
  RuntimePersistenceContract,
} from '@local-creative-os/contracts'
import type {
  ArtifactKind,
  Run,
  RunId,
  RuntimeBinding,
  RuntimeDispatch,
} from '@local-creative-os/domain'
import type { RuntimeProviderStatus } from '@local-creative-os/contracts'
import { isTerminalRunStatus } from '@local-creative-os/domain'

import type { RuntimeAdapterProfile, RuntimeAdapterRegistry } from './adapter-registry.js'
import { compileContextPromptV1, contextCacheTelemetryV1, type ContextPromptManifestSourceV1 } from './context-prompt-serializer.js'
import { AdapterUnsupportedError, defaultRuntimeAdapterRegistry } from './adapter-registry.js'

export function runtimeConstraintsForOutputIntent(outputIntent: 'create' | 'revise' | 'analyze'): readonly string[] {
  if (outputIntent === 'analyze') return [
    'Do not write any files.',
    'Return providerStatus review on success.',
  ]
  if (outputIntent === 'create') return [
    'Do not modify source files.',
    'Write new files only under the staging output root.',
    'Return providerStatus review on success.',
  ]
  return [
    'Do not modify source files.',
    'Write only the listed expected output.',
    'Return providerStatus review on success.',
  ]
}

export interface RuntimeExpectedOutputV0 {
  readonly absolutePath: string
  readonly mode: 'create_new_file'
}

export interface RuntimeInputPackV0 {
  readonly schemaVersion: 0
  readonly contractVersion: 'runtime-input-pack-v0'
  readonly lcosRunId: string
  readonly contextManifest: unknown
  /** Provider-neutral cache plan materialized from the frozen ContextManifest + current Run. */
  readonly compiledContextPrompt: CompiledContextPromptV1
  readonly contextCacheTelemetry: ContextCacheTelemetryV1
  readonly taskType: 'creative_run' | 'markdown_script_revision'
  readonly instruction: string
  readonly expectedOutputs: readonly RuntimeExpectedOutputV0[]
  readonly resultEnvelopePath: string
  readonly constraints: readonly string[]
  readonly resourceRefs?: readonly {
    readonly resourceId: string
    readonly artifactId: string
    readonly sourceRevisionId: string
    readonly descriptorHash: string
    readonly role: 'context' | 'candidate_skill' | 'reference' | 'tool_config'
    readonly matchReasons: readonly string[]
    readonly requiresApproval: boolean
  }[]
  readonly resourceFiles?: readonly {
    readonly resourceId: string
    readonly path: string
    readonly content: string
  }[]
}

export interface LegacyBridgeTaskEnvelopeV0 {
  readonly contractVersion: 'bridge-task-v0'
  readonly lcosRunId: string
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly provider: 'workbuddy' | 'codex'
  readonly taskType: 'creative_run' | 'markdown_script_revision'
  readonly runtimeInputPackPath: string
  readonly expectedOutputs: readonly RuntimeExpectedOutputV0[]
  readonly timeoutSeconds: number
  readonly reportMode: 'short'
}

export interface BridgeTaskEnvelopeV1 {
  readonly contractVersion: 'bridge-task-v1'
  readonly lcosRunId: string
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly manifestId: string
  readonly manifestHash: string
  readonly outputIntent: 'create' | 'revise' | 'analyze'
  readonly instructions: string
  readonly provider: 'workbuddy' | 'codex'
  readonly taskType: 'creative_run' | 'markdown_script_revision'
  readonly runtimeInputPackPath: string
  readonly outputRoot: string
  readonly expectedOutputs: readonly {
    readonly outputId: string
    readonly role: 'primary'
    readonly action: 'created' | 'modified'
    readonly absolutePath: string
    readonly mediaType: string
    readonly required: true
  }[]
  readonly outputPolicy: {
    readonly allowZeroFiles: boolean
    readonly allowAdditionalFiles: boolean
    readonly maxFiles: 1 | 5
  }
  readonly timeoutSeconds: number
  readonly reportMode: 'short'
  readonly metadata: {
    readonly projectId: string
  }
}

// Kept under the original exported name so existing V0 fixtures remain readable
// while new Runtime dispatches use the V1 member.
export type BridgeTaskEnvelopeV0 = LegacyBridgeTaskEnvelopeV0 | BridgeTaskEnvelopeV1

export interface BridgeTaskIdentity {
  readonly taskId: string
  readonly lcosRunId: string
  readonly status: string
  readonly requestFingerprint: string
  readonly contractVersion: string
  readonly sessionId?: string
  readonly leaseExpiresAt?: string
}

export interface BridgeRuntimePort {
  createTask(envelope: BridgeTaskEnvelopeV0, projectId: string): Promise<BridgeTaskIdentity>
  findTaskByRunId(runId: string): Promise<BridgeTaskIdentity | undefined>
  getTask?(taskId: string, runId: string): Promise<BridgeTaskIdentity | undefined>
  getResult(taskId: string, runId: string): Promise<BridgeResultEnvelopeV0 | undefined>
  finalizeReview?(taskId: string, decision: 'completed' | 'retrying', comment?: string): Promise<void>
  answerInput?(taskId: string, response: { readonly requestId: string; readonly text?: string; readonly selectedOptions?: readonly string[] }): Promise<void>
  cancelTask?(taskId: string, runId: string): Promise<void>
  getCapabilities?(): Promise<{
    readonly bridgeVersion?: string
    readonly primaryContractVersion?: string
    readonly providers?: readonly {
      readonly provider: string
      readonly executionMode?: string
      readonly taskTypes?: readonly string[]
      readonly outputIntents?: readonly string[]
      readonly contractVersions?: readonly string[]
      readonly sessionBinding?: boolean
      readonly completionHook?: boolean
    }[]
  }>
}

export interface BridgeResultEnvelopeV0 {
  readonly contractVersion: 'bridge-result-v0' | 'bridge-result-v1'
  readonly taskId: string
  readonly lcosRunId: string
  readonly providerStatus: 'review' | 'waiting_input' | 'failed' | 'cancelled' | 'timeout'
  readonly shortSummary?: string
  readonly resultSummary?: string
  readonly summary?: string
  readonly warnings?: readonly string[]
  readonly suggestedNextActions?: readonly string[]
  readonly inputRequest?: {
    readonly requestId: string
    readonly question: string
    readonly options: readonly string[]
    readonly allowFreeText: boolean
    readonly contextVersion?: number
    readonly createdAt?: string
  }
  readonly changedFiles: readonly {
    readonly path: string
    readonly action: 'created' | 'modified'
    readonly role?: string
    readonly mediaType?: string
  }[]
}

export interface RuntimeProviderError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly provider: 'workbuddy' | 'codex'
}

export class RuntimeAdapterError extends Error {
  constructor(readonly detail: RuntimeProviderError) {
    super(detail.message)
    this.name = 'RuntimeAdapterError'
  }
}

export interface RuntimeProjectReader {
  getProject(projectId: string): { readonly rootPath: string } | undefined
  getArtifact(artifactId: string): { readonly id: string; readonly kind: ArtifactKind } | undefined
  getArtifactRevision(revisionId: string): { readonly fileRecordId: string; readonly artifactId: string } | undefined
  getFileRecord(fileRecordId: string): { readonly observedPath: string; readonly mimeType: string } | undefined
  getResourceDescriptorByResourceId(projectId: string, resourceId: string): {
    readonly sourceRevisionId: string
    readonly source: { readonly kind: 'file' | 'directory' | 'archive' | 'external' | 'url' }
    readonly readFirst: readonly string[]
  } | undefined
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

export function createTaskRequestFingerprint(
  envelope: Omit<LegacyBridgeTaskEnvelopeV0, 'requestFingerprint'>
    | Omit<BridgeTaskEnvelopeV1, 'requestFingerprint'>,
): string {
  return createHash('sha256').update(canonicalJson(envelope), 'utf8').digest('hex')
}

function assertWithin(root: string, candidate: string): void {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error('Runtime path escapes the Project root.')
  }
}

async function writeImmutable(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code !== 'EEXIST') throw error
    if (await readFile(path, 'utf8') !== content) {
      throw new Error('RuntimeInputPack already exists with different content.')
    }
  }
}

function dispatchError(error: unknown, provider: 'workbuddy' | 'codex'): RuntimeProviderError {
  if (error instanceof RuntimeAdapterError) return error.detail
  return {
    code: 'BRIDGE_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Bridge request failed.',
    retryable: true,
    provider,
  }
}

export type AutomaticRuntimeProvider = 'workbuddy' | 'codex'

function automaticProvidersFromEnvironment(): ReadonlySet<AutomaticRuntimeProvider> {
  const values: AutomaticRuntimeProvider[] = []
  if (process.env.LCOS_CODEX_AUTO_EXECUTION === '1') values.push('codex')
  if (process.env.LCOS_WORKBUDDY_AUTO_EXECUTION === '1') values.push('workbuddy')
  return new Set(values)
}

export class RuntimeAdapterService {
  constructor(
    private readonly repository: RuntimePersistenceContract & RuntimeProjectReader,
    private readonly bridge: BridgeRuntimePort,
    private readonly bridgeProjectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly adapterRegistry: RuntimeAdapterRegistry = defaultRuntimeAdapterRegistry,
    private readonly automaticProviders: ReadonlySet<AutomaticRuntimeProvider> = automaticProvidersFromEnvironment(),
  ) {
    if (bridgeProjectId.trim() === '') throw new Error('Bridge project routing ID is required.')
  }

  async dispatch(runId: RunId): Promise<RuntimeBinding> {
    const run = this.requireRun(runId)
    const dispatch = this.requireDispatch(runId)
    const existingBinding = this.repository.getRuntimeBinding(runId)
    if (existingBinding !== undefined) return existingBinding

    const { envelope } = await this.materialize(run)
    this.repository.updateRuntimeDispatch({
      ...dispatch,
      status: 'dispatching',
      attemptCount: dispatch.attemptCount + 1,
      updatedAt: this.now(),
    })

    try {
      const task = await this.bridge.createTask(envelope, this.bridgeProjectId)
      return this.bind(run, task)
    } catch (error: unknown) {
      const detail = dispatchError(error, run.provider)
      this.repository.updateRuntimeDispatch({
        ...this.requireDispatch(runId),
        status: 'recovery_required',
        lastErrorCode: detail.code,
        lastErrorMessage: detail.message,
        updatedAt: this.now(),
      })
      throw new RuntimeAdapterError(detail)
    }
  }

  async recover(runId: RunId): Promise<RuntimeBinding> {
    const run = this.requireRun(runId)
    const existingBinding = this.repository.getRuntimeBinding(runId)
    if (existingBinding !== undefined) return existingBinding

    try {
      const found = await this.bridge.findTaskByRunId(String(runId))
      if (found !== undefined) return this.bind(run, found)
      const { envelope } = await this.materialize(run)
      return this.bind(run, await this.bridge.createTask(envelope, this.bridgeProjectId))
    } catch (error: unknown) {
      if (error instanceof AdapterUnsupportedError) throw error
      const detail = dispatchError(error, run.provider)
      this.repository.updateRuntimeDispatch({
        ...this.requireDispatch(runId),
        status: 'recovery_required',
        lastErrorCode: detail.code,
        lastErrorMessage: detail.message,
        updatedAt: this.now(),
      })
      throw new RuntimeAdapterError(detail)
    }
  }

  async sync(runId: RunId): Promise<RuntimeBinding> {
    const binding = this.repository.getRuntimeBinding(runId)
    const provider = binding?.provider ?? this.requireRun(runId).provider
    if (binding?.externalTaskId === undefined) {
      throw new RuntimeAdapterError({
        code: 'TASK_NOT_FOUND',
        message: 'RuntimeBinding has no external task.',
        retryable: false,
        provider,
      })
    }
    const task = this.bridge.getTask === undefined
      ? await this.bridge.findTaskByRunId(String(runId))
      : await this.bridge.getTask(binding.externalTaskId, String(runId))
    if (task === undefined || task.taskId !== binding.externalTaskId) {
      throw new RuntimeAdapterError({
        code: 'TASK_NOT_FOUND',
        message: 'Bridge Task binding was not found.',
        retryable: true,
        provider: binding.provider,
      })
    }
    const timestamp = this.now()
    const updated = this.repository.updateRuntimeBinding({
      ...binding,
      providerStatus: task.status,
      ...(task.sessionId === undefined ? {} : { externalSessionId: task.sessionId }),
      lastSyncedAt: timestamp,
      updatedAt: timestamp,
    })
    const canonicalStatus = this.canonicalStatus(task.status)
    if (canonicalStatus !== undefined) this.repository.updateRunStatus(runId, canonicalStatus, timestamp)
    return updated
  }

  async finalize(runId: RunId, decision: 'completed' | 'retrying', comment?: string): Promise<RuntimeBinding> {
    const binding = this.repository.getRuntimeBinding(runId)
    const provider = binding?.provider ?? this.requireRun(runId).provider
    if (binding?.externalTaskId === undefined) {
      throw new RuntimeAdapterError({
        code: 'TASK_NOT_FOUND',
        message: 'RuntimeBinding has no external task.',
        retryable: false,
        provider,
      })
    }
    if (this.bridge.finalizeReview === undefined) {
      throw new RuntimeAdapterError({
        code: 'CONTRACT_UNSUPPORTED',
        message: 'Bridge does not support review finalization.',
        retryable: false,
        provider: binding.provider,
      })
    }
    await this.bridge.finalizeReview(binding.externalTaskId, decision, comment)
    const timestamp = this.now()
    return this.repository.updateRuntimeBinding({
      ...binding,
      providerStatus: decision,
      lastSyncedAt: timestamp,
      finalizePending: false,
      updatedAt: timestamp,
    })
  }

  async answerInput(runId: RunId, response: { readonly requestId: string; readonly text?: string; readonly selectedOptions?: readonly string[] }): Promise<RuntimeBinding> {
    const run = this.requireRun(runId)
    if (run.status !== 'waiting_input') {
      throw new RuntimeAdapterError({
        code: 'RUN_NOT_WAITING_INPUT',
        message: 'Run is not waiting for input.',
        retryable: false,
        provider: run.provider,
      })
    }
    const binding = this.repository.getRuntimeBinding(runId)
    if (binding?.externalTaskId === undefined || this.bridge.answerInput === undefined) {
      throw new RuntimeAdapterError({
        code: 'CONTRACT_UNSUPPORTED',
        message: 'Bridge does not support answering input requests.',
        retryable: false,
        provider: run.provider,
      })
    }
    await this.bridge.answerInput(binding.externalTaskId, response)
    const timestamp = this.now()
    this.repository.updateRunStatus(runId, 'queued', timestamp)
    return this.repository.updateRuntimeBinding({
      ...binding,
      providerStatus: 'queued',
      lastSyncedAt: timestamp,
      updatedAt: timestamp,
    })
  }

  async cancel(runId: RunId): Promise<RuntimeBinding> {
    const run = this.requireRun(runId)
    if (isTerminalRunStatus(run.status)) {
      throw new RuntimeAdapterError({
        code: 'RUN_ALREADY_TERMINAL',
        message: `Run is already ${run.status}; cancellation is not allowed.`,
        retryable: false,
        provider: run.provider,
      })
    }
    const binding = this.repository.getRuntimeBinding(runId)
    if (binding?.externalTaskId === undefined) {
      // created/planned 等从未绑定外部任务的 Run：本地直接置为 cancelled，
      // providerAction 会负责补发 run.cancelled 事件。
      const timestamp = this.now()
      this.repository.updateRunStatus(runId, 'cancelled', timestamp)
      return binding ?? ({
        id: `binding-${runId}` as RuntimeBinding['id'],
        runId,
        provider: run.provider,
        externalTaskId: `local-cancel-${runId}`,
        providerStatus: 'cancelled' as const,
        finalizePending: false,
        lastSyncedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as RuntimeBinding)
    }
    if (this.bridge.cancelTask !== undefined) {
      await this.bridge.cancelTask(binding.externalTaskId, String(runId))
    }
    const timestamp = this.now()
    this.repository.updateRunStatus(runId, 'cancelled', timestamp)
    return this.repository.updateRuntimeBinding({
      ...binding,
      providerStatus: 'cancelled',
      lastSyncedAt: timestamp,
      updatedAt: timestamp,
    })
  }

  async providersStatus(): Promise<readonly RuntimeProviderStatus[]> {
    const caps = this.bridge.getCapabilities === undefined
      ? undefined
      : await this.bridge.getCapabilities().catch(() => undefined)
    const bridgeOnline = caps !== undefined
    const providerRows = caps?.providers ?? []
    const known: RuntimeProviderStatus[] = []
    for (const provider of ['workbuddy', 'codex'] as const) {
      const row = providerRows.find((item) => String(item.provider).toLocaleLowerCase('en-US') === provider)
      if (row === undefined) {
        known.push({ provider, availability: bridgeOnline ? 'offline' : 'offline' })
        continue
      }
      const contractVersion = row.contractVersions?.[0] ?? caps?.primaryContractVersion
      const automatic = this.automaticProviders.has(provider)
      known.push({
        provider,
        availability: bridgeOnline ? (automatic ? 'ready' : 'manual') : 'offline',
        executionMode: automatic ? 'automatic' : 'manual',
        ...(contractVersion === undefined ? {} : { contractVersion }),
        ...(row.outputIntents === undefined ? {} : { outputIntents: row.outputIntents }),
        ...(!automatic ? { reason: '未检测到由 LCOS Runtime Host 托管的自动执行器。' } : {}),
      })
    }
    const automaticReady = known.some((item) => item.executionMode === 'automatic' && ['ready', 'busy'].includes(item.availability))
    const manualAvailable = known.some((item) => item.availability === 'manual')
    known.push({
      provider: 'auto',
      availability: automaticReady ? 'ready' : manualAvailable ? 'manual' : 'offline',
      executionMode: automaticReady ? 'automatic' : 'manual',
      ...(!automaticReady ? { reason: '暂无由 LCOS Runtime Host 托管的自动执行器。' } : {}),
    })
    return known
  }

  async getCodexTaskState(runId: RunId): Promise<{ readonly status?: string; readonly leaseExpiresAt?: string } | undefined> {
    const task = await this.bridge.findTaskByRunId(String(runId))
    if (task === undefined) return undefined
    return {
      ...(typeof task.status === 'string' ? { status: task.status } : {}),
      ...(task.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: task.leaseExpiresAt }),
    }
  }

  private async materialize(run: Run): Promise<{ envelope: BridgeTaskEnvelopeV1 }> {
    const manifest = this.repository.getContextManifest(run.contextManifestId)
    if (manifest === undefined) throw new Error('ContextManifest not found.')
    const project = this.repository.getProject(String(run.projectId))
    if (project === undefined) throw new Error('Project not found.')

    const runtimeRoot = resolve(project.rootPath, '.creative-os', 'runtime', String(run.id))
    const packPath = resolve(runtimeRoot, 'runtime-input-pack.json')
    const isAnalyze = run.outputIntent === 'analyze'
    const isCreate = run.outputIntent === 'create'
    const profile = this.resolveProfile(run, isAnalyze, isCreate)
    const outputPath = isAnalyze || isCreate
      ? undefined
      : resolve(runtimeRoot, 'staging', `${profile.outputName}-${String(run.id)}${profile.fileExtension}`)
    const resultEnvelopePath = resolve(runtimeRoot, 'result', 'result-envelope-v0.json')
    assertWithin(project.rootPath, packPath)
    if (outputPath !== undefined) assertWithin(runtimeRoot, outputPath)
    await mkdir(resolve(runtimeRoot, 'staging'), { recursive: true })
    await mkdir(resolve(runtimeRoot, 'result'), { recursive: true })

    const expectedOutputs = outputPath === undefined
      ? []
      : [{ absolutePath: outputPath, mode: 'create_new_file' as const }]
    const constraints = runtimeConstraintsForOutputIntent(run.outputIntent)
    const parsedManifest = JSON.parse(manifest.canonicalJson) as ContextPromptManifestSourceV1 & {
      resourceRefs?: RuntimeInputPackV0['resourceRefs']
    }
    const compiledContextPrompt = compileContextPromptV1({
      manifest: parsedManifest,
      userTask: run.instruction,
      outputIntent: run.outputIntent,
      runConstraints: constraints,
    })
    const contextCacheTelemetry = contextCacheTelemetryV1(compiledContextPrompt, run.provider)
    const resourceRefs = parsedManifest.resourceRefs
    const resourceFiles = resourceRefs === undefined || resourceRefs.length === 0
      ? undefined
      : await this.#resourcePackFiles(String(run.projectId), resourceRefs)
    const pack: RuntimeInputPackV0 = {
      schemaVersion: 0,
      contractVersion: 'runtime-input-pack-v0',
      lcosRunId: String(run.id),
      contextManifest: parsedManifest,
      compiledContextPrompt,
      contextCacheTelemetry,
      taskType: profile.taskType,
      instruction: run.instruction,
      expectedOutputs,
      resultEnvelopePath,
      constraints,
      ...(resourceRefs === undefined || resourceRefs.length === 0 ? {} : { resourceRefs }),
      ...(resourceFiles === undefined || resourceFiles.length === 0 ? {} : { resourceFiles }),
    }
    await writeImmutable(packPath, `${canonicalJson(pack)}\n`)

    const unsigned: Omit<BridgeTaskEnvelopeV1, 'requestFingerprint'> = {
      contractVersion: 'bridge-task-v1',
      lcosRunId: String(run.id),
      idempotencyKey: String(run.id),
      manifestId: String(manifest.id),
      manifestHash: manifest.manifestHash,
      outputIntent: run.outputIntent,
      instructions: run.instruction,
      provider: run.requestedProvider,
      taskType: profile.taskType,
      runtimeInputPackPath: packPath,
      outputRoot: resolve(runtimeRoot, 'staging'),
      expectedOutputs: outputPath === undefined
        ? []
        : [{
            outputId: 'primary-draft',
            role: 'primary',
            action: run.outputIntent === 'revise' ? 'modified' : 'created',
            absolutePath: outputPath,
            mediaType: profile.mediaType,
            required: true,
          }],
      outputPolicy: {
        allowZeroFiles: isAnalyze,
        allowAdditionalFiles: isCreate,
        maxFiles: isAnalyze || isCreate ? 5 : 1,
      },
      timeoutSeconds: 600,
      reportMode: 'short',
      metadata: { projectId: this.bridgeProjectId },
    }
    const requestFingerprint = createTaskRequestFingerprint(unsigned)
    return { envelope: { ...unsigned, requestFingerprint } }
  }

  private resolveProfile(
    run: Run,
    isAnalyze: boolean,
    isCreate: boolean,
  ): RuntimeAdapterProfile {
    if (isAnalyze) return this.adapterRegistry.resolveAnalyze()
    if (isCreate) return this.adapterRegistry.resolveCreate()
    if (run.targetArtifactId === undefined || run.targetRevisionId === undefined) {
      throw new RuntimeAdapterError({
        code: 'CONTRACT_UNSUPPORTED',
        message: 'Revise Run requires a target Artifact and Base Revision before dispatch.',
        retryable: false,
        provider: run.provider,
      })
    }
    const artifact = this.repository.getArtifact(String(run.targetArtifactId))
    const revision = this.repository.getArtifactRevision(String(run.targetRevisionId))
    const fileRecord = revision === undefined
      ? undefined
      : this.repository.getFileRecord(String(revision.fileRecordId))
    if (artifact === undefined || revision === undefined || fileRecord === undefined) {
      throw new RuntimeAdapterError({
        code: 'RUNTIME_STORAGE_CORRUPT',
        message: 'Revise target evidence is missing.',
        retryable: false,
        provider: run.provider,
      })
    }
    return this.adapterRegistry.resolveRevise(artifact, fileRecord)
  }

  async #resourcePackFiles(
    projectId: string,
    refs: NonNullable<RuntimeInputPackV0['resourceRefs']>,
  ): Promise<NonNullable<RuntimeInputPackV0['resourceFiles']>> {
    const result: Array<{
      readonly resourceId: string
      readonly path: string
      readonly content: string
    }> = []
    for (const ref of refs.slice(0, 6)) {
      const descriptor = this.repository.getResourceDescriptorByResourceId(projectId, ref.resourceId)
      if (descriptor === undefined) continue
      result.push({
        resourceId: ref.resourceId,
        path: '<descriptor>',
        content: JSON.stringify(descriptor).slice(0, 64 * 1024),
      })
      const revision = this.repository.getArtifactRevision(ref.sourceRevisionId)
      const fileRecord = revision === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
      if (fileRecord === undefined) continue
      try {
        if (descriptor.source.kind === 'directory') {
          const manifestText = await readFile(fileRecord.observedPath, 'utf8')
          const manifest = JSON.parse(manifestText) as { files?: readonly { path: string }[] }
          const filePaths = new Set((manifest.files ?? []).map((file) => file.path))
          const sourceRoot = resolve(dirname(fileRecord.observedPath), 'source')
          for (const path of descriptor.readFirst.slice(0, 4)) {
            if (!filePaths.has(path)) continue
            const target = resolve(sourceRoot, path)
            if (relative(sourceRoot, target).startsWith('..')) continue
            const content = await readFile(target, 'utf8')
            result.push({ resourceId: ref.resourceId, path, content: content.slice(0, 32 * 1024) })
          }
        } else if (descriptor.readFirst.length === 0) {
          const content = await readFile(fileRecord.observedPath, 'utf8')
          result.push({ resourceId: ref.resourceId, path: 'content', content: content.slice(0, 32 * 1024) })
        }
      } catch {
        // Resource files are best-effort; a failed read never blocks dispatch.
      }
    }
    return result
  }

  private bind(run: Run, task: BridgeTaskIdentity): RuntimeBinding {
    if (task.lcosRunId !== String(run.id)) throw new Error('Bridge Task belongs to another Run.')
    const timestamp = this.now()
    const binding: RuntimeBinding = {
      id: `binding-${String(run.id)}` as RuntimeBinding['id'],
      runId: run.id,
      provider: run.provider,
      externalTaskId: task.taskId,
      ...(task.sessionId === undefined ? {} : { externalSessionId: task.sessionId }),
      providerStatus: task.status,
      lastSyncedAt: timestamp,
      finalizePending: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.repository.createRuntimeBinding(binding)
    const currentDispatch = this.requireDispatch(run.id)
    const {
      lastErrorCode: _lastErrorCode,
      lastErrorMessage: _lastErrorMessage,
      ...clearedDispatch
    } = currentDispatch
    this.repository.updateRuntimeDispatch({
      ...clearedDispatch,
      status: 'bound',
      updatedAt: timestamp,
    })
    const canonicalStatus = this.canonicalStatus(task.status)
    if (canonicalStatus !== undefined) this.repository.updateRunStatus(run.id, canonicalStatus, timestamp)
    return binding
  }

  private canonicalStatus(providerStatus: string): Run['status'] | undefined {
    if (providerStatus === 'created' || providerStatus === 'queued' || providerStatus === 'assigned') return 'queued'
    if (providerStatus === 'running' || providerStatus === 'claimed') return 'running'
    if (providerStatus === 'waiting_input') return 'waiting_input'
    if (providerStatus === 'failed') return 'failed'
    if (providerStatus === 'cancelled') return 'cancelled'
    return undefined
  }

  private requireRun(runId: RunId): Run {
    const run = this.repository.getRun(runId)
    if (run === undefined) throw new Error('Run not found.')
    return run
  }

  private requireDispatch(runId: RunId): RuntimeDispatch {
    const dispatch = this.repository.getRuntimeDispatch(runId)
    if (dispatch === undefined) throw new Error('RuntimeDispatch not found.')
    return dispatch
  }
}
