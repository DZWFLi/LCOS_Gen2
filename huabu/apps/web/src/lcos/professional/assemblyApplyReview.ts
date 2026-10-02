import type { AssemblyApplyItemResultV1, AssemblyApplyRequestV1, AssemblyApplyResultV1, AssemblySourceRefV1 } from '@local-creative-os/contracts';

/** The exact request identity. Skill catalog and version are not interchangeable. */
export function assemblySourceKey(ref: AssemblySourceRefV1): string {
  return JSON.stringify(ref.kind === 'skill' ? [ref.kind, ref.id, ref.source, ref.version ?? null] : [ref.kind, ref.id]);
}

const SOURCE_KINDS = new Set(['artifactView', 'capture', 'resource', 'conversation', 'context', 'workflow', 'scene', 'collection', 'skill', 'note']);
const WRITE_CHANNELS = new Set(['workspace-membership', 'presentation-membership', 'relation', 'capture-materialize']);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function source(value: unknown): value is AssemblySourceRefV1 {
  return record(value) && typeof value.kind === 'string' && SOURCE_KINDS.has(value.kind)
    && typeof value.id === 'string' && value.id.trim().length > 0
    && (value.kind !== 'skill' || (['system', 'user', 'merged'].includes(String(value.source))
      && (value.version === undefined || typeof value.version === 'string')));
}
function consistent(line: Record<string, unknown>): boolean {
  if (line.message !== undefined && typeof line.message !== 'string') return false;
  if (line.status === 'applied') return WRITE_CHANNELS.has(String(line.channel));
  if (line.status === 'skipped') return line.channel === 'already-member' || line.channel === 'unsupported';
  if (line.status === 'failed') return line.channel === 'error' || line.channel === 'unsupported';
  return false;
}
export function unconfirmedAssemblyItem(sourceRef: AssemblySourceRefV1): AssemblyApplyItemResultV1 {
  return { sourceRef, status: 'failed', channel: 'error', message: '结果尚未确认，请先查看目标。' };
}

/** One decoder for button, batch and Drop. Runtime input is untrusted even after HTTP 200.
 * A foreign/malformed envelope is wholly unknown; a missing/duplicate/contradictory row is unknown
 * for that request source only. Never infer a retry from an unknown result. */
export function reviewAssemblyApply(request: Pick<AssemblyApplyRequestV1, 'projectId' | 'sourceRefs'>, receipt: unknown) {
  const keys = new Set(request.sourceRefs.map(assemblySourceKey));
  const envelope = record(receipt) && typeof request.projectId === 'string' && request.projectId.trim() !== '' && receipt.projectId === request.projectId
    && receipt.schemaVersion === 1 && Array.isArray(receipt.results) ? receipt : undefined;
  const rawRows: readonly unknown[] = envelope ? envelope.results as unknown[] : [];
  const scoped = envelope !== undefined && rawRows.every((line) => record(line) && source(line.sourceRef)
    && keys.has(assemblySourceKey(line.sourceRef)));
  const rows = new Map<string, Record<string, unknown>[]>();
  if (scoped) for (const raw of rawRows) {
    const line = raw as Record<string, unknown>;
    const key = assemblySourceKey(line.sourceRef as AssemblySourceRefV1);
    rows.set(key, [...(rows.get(key) ?? []), line]);
  }
  const unknownKeys: string[] = [];
  const retrySourceRefs: AssemblySourceRefV1[] = [];
  const normalized = request.sourceRefs.map((sourceRef): AssemblyApplyItemResultV1 => {
    const key = assemblySourceKey(sourceRef);
    const matches = rows.get(key) ?? [];
    const line = matches.length === 1 ? matches[0] : undefined;
    if (!line || !consistent(line)) {
      unknownKeys.push(key); return unconfirmedAssemblyItem(sourceRef);
    }
    if (line.status === 'failed' && line.channel === 'error') retrySourceRefs.push(sourceRef);
    // Identity comes from the frozen request, never a substituted server object.
    return { ...line, sourceRef } as unknown as AssemblyApplyItemResultV1;
  });
  const result: AssemblyApplyResultV1 = {
    schemaVersion: 1, projectId: request.projectId, results: normalized,
    ...(scoped && typeof envelope?.changeSetId === 'string' ? { changeSetId: envelope.changeSetId } : {}),
    allApplied: normalized.length > 0 && unknownKeys.length === 0 && normalized.every((line) => line.status === 'applied'
      || (line.status === 'skipped' && line.channel === 'already-member')),
  };
  return { result, unknownKeys, retrySourceRefs };
}
