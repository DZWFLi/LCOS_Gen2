/** Source Bay layout only. It neither reads nor moves the canvas camera. */
export const ASSEMBLY_ITEM_WIDTH = { min: 184, max: 320, default: 248 } as const;
export function clampAssemblyItemWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(ASSEMBLY_ITEM_WIDTH.min, Math.min(ASSEMBLY_ITEM_WIDTH.max, Math.round(width)))
    : ASSEMBLY_ITEM_WIDTH.default;
}
export function assemblyRowSpan(height: number, gap = 24): number {
  return Math.max(1, Math.ceil((Number.isFinite(height) ? height : 0) + gap));
}
export interface AssemblyBrowseAnchor { readonly key: string; readonly offset: number; }
export function captureAssemblyBrowseAnchor(scroll: HTMLElement | null): AssemblyBrowseAnchor | undefined {
  if (!scroll || scroll.clientHeight === 0) return undefined;
  const top = scroll.getBoundingClientRect().top;
  const cell = [...scroll.querySelectorAll<HTMLElement>('[data-assembly-cell]')]
    .find((entry) => entry.getBoundingClientRect().bottom > top + 1);
  return cell ? { key: cell.dataset.assemblyCell ?? '', offset: cell.getBoundingClientRect().top - top } : undefined;
}
export function restoreAssemblyBrowseAnchor(scroll: HTMLElement | null, anchor: AssemblyBrowseAnchor | undefined): void {
  if (!scroll || !anchor) return;
  const cell = [...scroll.querySelectorAll<HTMLElement>('[data-assembly-cell]')]
    .find((entry) => entry.dataset.assemblyCell === anchor.key);
  if (cell) scroll.scrollTop += cell.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
}
