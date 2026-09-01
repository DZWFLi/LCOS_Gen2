import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface TrustedPathPolicy {
  readonly projectRoot: string
  readonly allowExternalSource: boolean
}

export interface GuardedFilePath {
  readonly normalizedPath: string
  readonly realPath: string
  readonly size: number
  readonly modifiedAt: string
}

function comparisonPath(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(comparisonPath(root), comparisonPath(candidate))
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

/** 复用同一 canonicalizer：路径亲和性判断与 path-guard 完全一致。 */
export function canonicalComparisonPath(value: string): string {
  return comparisonPath(value)
}

export function guardTrustedFilePath(
  selectedPath: string,
  policy: TrustedPathPolicy,
): GuardedFilePath {
  if (!isAbsolute(selectedPath)) throw new Error('Trusted file selection must be an absolute path.')
  const normalizedPath = resolve(selectedPath)
  const realPath = realpathSync.native(normalizedPath)
  const projectRoot = realpathSync.native(resolve(policy.projectRoot))
  if (!policy.allowExternalSource && !isContained(projectRoot, realPath)) {
    throw new Error('Selected file resolves outside the allowed project root.')
  }
  const stat = statSync(realPath)
  if (!stat.isFile()) throw new Error('Selected path must resolve to a readable file.')
  accessSync(realPath, constants.R_OK)
  return {
    normalizedPath,
    realPath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}
