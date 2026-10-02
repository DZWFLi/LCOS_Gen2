/** DOM retention only. Window ids/topology remain in lcosShellStore and content
 * identity/revision remain in the existing Reader. Never duplicate a Reader to
 * make a tab or a split preview look populated. */
export function placeRetainedReader(element: HTMLElement, slot: HTMLElement | undefined, visible: boolean): void {
  element.hidden = !visible;
  element.inert = !visible;
  element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) {
    for (const media of element.querySelectorAll<HTMLMediaElement>('video,audio')) media.pause();
  }
  if (slot === undefined || element.parentElement === slot) return;
  // Browsers supporting state-preserving DOM moves retain media/embedded state.
  // Otherwise keep the same React portal container and move its DOM subtree.
  const parent = slot as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
  if (element.isConnected && slot.isConnected && typeof parent.moveBefore === 'function') {
    try { parent.moveBefore(element, null); return; } catch { /* Fall back for unsupported DOM states. */ }
  }
  slot.appendChild(element);
}
