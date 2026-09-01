import type { ContractError, Result } from '@local-creative-os/contracts'

export type LocalCoreErrorCode =
  | 'STALE_PRESENTATION_VERSION'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'INVALID_ARGUMENT'
  | 'PROJECT_ROOT_NOT_FOUND'
  | 'PROJECT_ROOT_NOT_DIRECTORY'
  | 'PROJECT_ROOT_NOT_READABLE'
  | 'PATH_OUTSIDE_ALLOWED_ROOT'
  | 'ACTIVE_CONTEXT_CONFLICT'
  | 'ABORTED'
  | 'INTERNAL'

export function failure(
  code: LocalCoreErrorCode,
  message: string,
  retryable = false,
): Extract<Result<never>, { readonly ok: false }> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      origin: 'runtime',
    },
  }
}

export function isContractError(value: unknown): value is ContractError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ContractError>
  return (
    typeof candidate.code === 'string'
    && typeof candidate.message === 'string'
    && typeof candidate.retryable === 'boolean'
    && candidate.origin === 'runtime'
  )
}
