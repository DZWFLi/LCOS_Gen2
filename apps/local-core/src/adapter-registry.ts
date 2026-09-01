import type { ArtifactKind } from '@local-creative-os/domain'

/**
 * Adapter Registry (Slice B-3 / RUN-06): resolves the Runtime contract
 * from Intent × Artifact Kind × MIME instead of hardcoding Markdown.
 *
 * Intent mapping:
 * - analyze → zero-file contract (no output profile needed)
 * - create  → open contract: 1–5 new files under the staging output root
 * - revise  → registered formats only; anything else fails BEFORE dispatch
 */

export type RuntimeWorkflowId = 'markdown_script_revision' | 'creative_run'

export interface RuntimeAdapterProfile {
  readonly workflow: RuntimeWorkflowId
  readonly taskType: RuntimeWorkflowId
  /** Output file name stem, e.g. `script-draft`. */
  readonly outputName: string
  /** Output file extension including the dot, e.g. `.md`. */
  readonly fileExtension: string
  /** Declared media type for the expected output. */
  readonly mediaType: string
}

export interface AdapterUnsupportedDetail {
  readonly code: 'UNSUPPORTED_OUTPUT_FORMAT'
  readonly message: string
  readonly retryable: false
  readonly provider: 'workbuddy'
}

export class AdapterUnsupportedError extends Error {
  constructor(readonly detail: AdapterUnsupportedDetail) {
    super(detail.message)
    this.name = 'AdapterUnsupportedError'
  }
}

export interface RuntimeAdapterRegistry {
  resolveRevise(
    artifact: { readonly kind: ArtifactKind },
    fileRecord: { readonly mimeType: string },
  ): RuntimeAdapterProfile
  resolveCreate(): RuntimeAdapterProfile
  resolveAnalyze(): RuntimeAdapterProfile
}

const MARKDOWN_REVISE_PROFILE: RuntimeAdapterProfile = {
  workflow: 'markdown_script_revision',
  taskType: 'markdown_script_revision',
  outputName: 'script-draft',
  fileExtension: '.md',
  mediaType: 'text/markdown',
}

const OPEN_CREATE_PROFILE: RuntimeAdapterProfile = {
  workflow: 'creative_run',
  taskType: 'creative_run',
  outputName: '',
  fileExtension: '',
  mediaType: 'application/octet-stream',
}

const ZERO_OUTPUT_ANALYZE_PROFILE: RuntimeAdapterProfile = {
  workflow: 'creative_run',
  taskType: 'creative_run',
  outputName: '',
  fileExtension: '',
  mediaType: 'application/octet-stream',
}

function unsupported(
  artifact: { readonly kind: ArtifactKind },
  fileRecord: { readonly mimeType: string },
): AdapterUnsupportedError {
  return new AdapterUnsupportedError({
    code: 'UNSUPPORTED_OUTPUT_FORMAT',
    message: `Revise of ${artifact.kind} (${fileRecord.mimeType}) is not supported yet; only Markdown/plain-text targets are registered.`,
    retryable: false,
    provider: 'workbuddy',
  })
}

export const defaultRuntimeAdapterRegistry: RuntimeAdapterRegistry = {
  resolveRevise(artifact, fileRecord) {
    const mime = fileRecord.mimeType.toLocaleLowerCase('en-US')
    if (artifact.kind === 'markdown'
      || mime === 'text/markdown'
      || mime === 'text/x-markdown'
      || mime === 'text/plain') {
      return MARKDOWN_REVISE_PROFILE
    }
    throw unsupported(artifact, fileRecord)
  },
  resolveCreate() {
    return OPEN_CREATE_PROFILE
  },
  resolveAnalyze() {
    return ZERO_OUTPUT_ANALYZE_PROFILE
  },
}
