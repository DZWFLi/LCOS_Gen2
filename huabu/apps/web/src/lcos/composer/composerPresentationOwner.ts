import { composerInputKey } from './composerInputJourney';
import type { LcosComposerTarget, LcosWindow } from '../shell/lcosShellStore';

/** Presentation only. Match visible window bodies using their existing ownership rules. */
export function composerHasVisibleWindowOwner(
  target: LcosComposerTarget | null,
  windows: readonly LcosWindow[],
  visibleWindowIds: readonly string[],
): boolean {
  if (target === null) return false;
  const borrowed = windows.find((window) => window.bodyKey === 'assembly'
    && window.composerOriginKey !== undefined && window.composerOriginKey === composerInputKey(target)
    && visibleWindowIds.includes(window.id));
  if (borrowed) return true;
  const assemblyIntent = target.nodeId.startsWith('assembly:');
  return visibleWindowIds.some((windowId) => {
    const activeWindow = windows.find((window) => window.id === windowId);
    if (activeWindow === undefined) return false;
    if (assemblyIntent) return activeWindow.bodyKey === 'assembly';
    return activeWindow.bodyKey === 'conversation'
      && target.receiverConversationId !== undefined
      && activeWindow.target === target.receiverConversationId;
  });
}

/** A visible Assembly detour takes the same Composer body, never a second simultaneous input. */
export function assemblyBorrowsComposer(target: LcosComposerTarget | null, windows: readonly LcosWindow[], visibleIds: readonly string[]): boolean {
  const key = composerInputKey(target);
  return key !== undefined && windows.some((window) => window.bodyKey === 'assembly'
    && window.composerOriginKey === key && visibleIds.includes(window.id));
}
