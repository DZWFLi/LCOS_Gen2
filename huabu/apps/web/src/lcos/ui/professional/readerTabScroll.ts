/** Reveal only inside the content-tab strip. Never scroll a document/Canvas ancestor. */
export function readerTabScrollLeft(input: { readonly scrollLeft: number; readonly viewportWidth: number; readonly scrollWidth: number; readonly tabLeft: number; readonly tabWidth: number }): number {
  const { scrollLeft, viewportWidth, scrollWidth, tabLeft, tabWidth } = input;
  if (![scrollLeft, viewportWidth, scrollWidth, tabLeft, tabWidth].every(Number.isFinite) || viewportWidth <= 0) return scrollLeft;
  const right = tabLeft + Math.min(tabWidth, viewportWidth);
  const next = tabLeft < scrollLeft ? tabLeft : right > scrollLeft + viewportWidth ? right - viewportWidth : scrollLeft;
  return Math.max(0, Math.min(Math.max(0, scrollWidth - viewportWidth), next));
}
