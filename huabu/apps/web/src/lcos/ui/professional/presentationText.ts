/** Exact visible-copy comparison only. Never infer semantic equivalence. */
export function sameVisibleCopy(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim() === b.trim();
}

/** Only neutral process prose can be tucked away. Actions remain outside. */
export function canPeekProcess(kind: string, presentation: string, tone: string): boolean {
  return presentation === 'activity' && tone === 'neutral'
    && (kind === 'progress' || kind === 'work_started' || kind === 'system_note');
}
