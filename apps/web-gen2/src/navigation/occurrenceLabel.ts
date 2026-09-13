// occurrence 行标签纯逻辑（Wave 0 从 c1b5e25 的 LcosFocusWhere.tsx 提取，React-free）。
// surface 短名 + workspace 名；名称已含 surface 前缀时不重复（Context · Context ×）。

export const SURFACE_LABEL: Readonly<Record<string, string>> = {
  main: 'Main',
  context: 'Context',
  workflow: 'Workflow',
};

export interface OccurrenceRowSource {
  readonly surface?: string;
  readonly workspaceName?: string;
}

/** surface 短名 + workspace 名；名称已含 surface 前缀时不重复显示。 */
export function occurrenceRowLabel(occurrence: OccurrenceRowSource): string {
  const surface =
    occurrence.surface !== undefined
      ? (SURFACE_LABEL[occurrence.surface] ?? occurrence.surface)
      : '画布';
  const name = occurrence.workspaceName;
  if (name === undefined || name === '') return surface;
  if (
    name === surface ||
    name.startsWith(`${surface} · `) ||
    name.startsWith(`${surface}·`)
  ) {
    return name;
  }
  return `${surface} · ${name}`;
}