import type {
  AbortSignal as ContractAbortSignal,
  GraphVersion,
  ProjectCatalog,
  ProjectCatalogEntry,
  Result,
} from '@local-creative-os/contracts'

import { failure } from './errors.js'

function cloneEntry(entry: ProjectCatalogEntry): ProjectCatalogEntry {
  return { id: entry.id, name: entry.name, rootPath: entry.rootPath, graphVersion: entry.graphVersion ?? (1 as GraphVersion) }
}

export class ExplicitProjectCatalog implements ProjectCatalog {
  readonly #entries: readonly ProjectCatalogEntry[]
  readonly #duplicateId: string | undefined

  constructor(entries: readonly ProjectCatalogEntry[]) {
    this.#entries = entries.map(cloneEntry)
    const seen = new Set<string>()
    this.#duplicateId = this.#entries.find((entry) => {
      if (seen.has(entry.id)) return true
      seen.add(entry.id)
      return false
    })?.id
  }

  async list(signal?: ContractAbortSignal): Promise<Result<readonly ProjectCatalogEntry[]>> {
    if (signal?.aborted) return failure('ABORTED', 'Project catalog request was aborted.')
    if (this.#duplicateId !== undefined) {
      return failure('INVALID_ARGUMENT', `Duplicate project id: ${this.#duplicateId}`)
    }
    return { ok: true, value: this.#entries.map(cloneEntry) }
  }
}
