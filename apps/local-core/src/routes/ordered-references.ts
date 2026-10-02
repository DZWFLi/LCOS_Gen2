import { isRecord } from './route-context.js'

const REF_TYPES = ['artifact', 'view', 'scope', 'workspace', 'conversation', 'component'] as const

/** Shared parser retains R9 exact locator validation for Run and continuation entry points. */
export function parseOrderedReferences(raw: unknown): { readonly value: readonly import('@local-creative-os/contracts').OrderedRunReferenceV2[] } | { readonly error: string } {
  if (!Array.isArray(raw)) return { error: 'orderedReferences must be an array.' }
  const value: import('@local-creative-os/contracts').OrderedRunReferenceV2[] = []
  const seenOrder = new Set<number>()
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || !isRecord(entry.ref) || typeof entry.order !== 'number'
      || !Number.isSafeInteger(entry.order) || entry.order < 0 || seenOrder.has(entry.order)) {
      return { error: `orderedReferences[${index}] requires a unique non-negative integer order and a typed ref.` }
    }
    if (Object.keys(entry).some(key => !['ref', 'order', 'mode'].includes(key))) {
      return { error: `orderedReferences[${index}] contains unsupported fields.` }
    }
    if (entry.mode !== undefined && (typeof entry.mode !== 'string' || !['full', 'summary', 'structure'].includes(entry.mode))) {
      return { error: `orderedReferences[${index}].mode is invalid.` }
    }
    const ref = entry.ref
    const type = ref.type
    if (!REF_TYPES.some(candidate => candidate === type)) {
      return { error: `orderedReferences[${index}].ref.type is invalid.` }
    }
    const idKey = type === 'view' ? 'viewId' : type === 'artifact' ? 'artifactId' : type === 'scope' ? 'scopeId' : type === 'workspace' ? 'workspaceId' : type === 'conversation' ? 'conversationSessionId' : 'componentId'
    const optionalKey = type === 'artifact' ? 'revisionId' : type === 'component' ? 'presentationId' : undefined
    if (typeof ref[idKey] !== 'string' || !(ref[idKey] as string).trim()
      || (optionalKey !== undefined && ref[optionalKey] !== undefined && (typeof ref[optionalKey] !== 'string' || !(ref[optionalKey] as string).trim()))
      || Object.keys(ref).some(key => key !== 'type' && key !== idKey && key !== optionalKey)) {
      return { error: `orderedReferences[${index}].ref has an invalid identity or unsupported locator.` }
    }
    // Validate the full declared union before this cast. Do not silently erase revisionId or mode.
    const refValue = { type, [idKey]: ref[idKey],
      ...(optionalKey === undefined || ref[optionalKey] === undefined ? {} : { [optionalKey]: ref[optionalKey] }),
    } as import('@local-creative-os/contracts').RunReferenceRefV2
    value.push({ ref: refValue, order: entry.order,
      ...(entry.mode === undefined ? {} : { mode: entry.mode as 'full' | 'summary' | 'structure' }),
    })
    seenOrder.add(entry.order)
  }
  return { value }
}
