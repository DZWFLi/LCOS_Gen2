import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export type AssemblyMaterialFilter = 'all' | 'image' | 'text' | 'media' | 'collection';
export type AssemblyMaterialShape = 'image' | 'text' | 'document' | 'video' | 'audio' | 'link' | 'file' | 'context' | 'workflow' | 'conversation' | 'skill';
export const ASSEMBLY_FILTERS: readonly { readonly value: AssemblyMaterialFilter; readonly label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'image', label: '图片' },
  { value: 'text', label: '文字' }, { value: 'media', label: '影音' },
  { value: 'collection', label: '集合' },
];

/** GEN1 Warehouse itemIcon taxonomy, projected onto the existing Figma material bodies. */
export function assemblyMaterialShape(item: Pick<WarehouseItemV1, 'kind' | 'visualFamily'>): AssemblyMaterialShape {
  if (item.kind === 'context' || item.kind === 'collection' || item.kind === 'scene') { return 'context'; }
  if (item.kind === 'workflow') { return 'workflow'; }
  if (item.kind === 'conversation') { return 'conversation'; }
  if (item.kind === 'note') { return 'text'; }
  switch (item.visualFamily) {
    case 'image': return 'image';
    case 'markdown': return 'text';
    case 'pdf': case 'ppt': return 'document';
    case 'audio': return 'audio';
    case 'video': return 'video';
    case 'link': return 'link';
    default: return 'file';
  }
}
export function captureMaterialShape(kind: string): AssemblyMaterialShape {
  switch (kind) {
    case 'image': case 'web_image': case 'clipboard_image': case 'screenshot': return 'image';
    case 'text': case 'web_selection': case 'clipboard_text': return 'text';
    case 'url': case 'web_link': case 'web_page': return 'link';
    case 'conversation_snapshot': return 'conversation';
    default: return 'file';
  }
}
export function matchesAssemblyFilter(shape: AssemblyMaterialShape, filter: AssemblyMaterialFilter): boolean {
  return filter === 'all' || (filter === 'image' && shape === 'image')
    || (filter === 'text' && (shape === 'text' || shape === 'document'))
    || (filter === 'media' && (shape === 'video' || shape === 'audio'))
    || (filter === 'collection' && (shape === 'context' || shape === 'workflow'));
}
/** GEN1 CaptureWorkspace selection pruning; local UI selection, never membership truth. */
export function retainAssemblySelection(selected: readonly string[], available: ReadonlySet<string>): readonly string[] {
  const next = selected.filter((id) => available.has(id));
  return next.length === selected.length ? selected : next;
}
export function toggleAssemblySelection(selected: readonly string[], id: string): readonly string[] {
  return selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id];
}
export function safeAssemblyLink(value?: string): string | undefined {
  if (!value) { return undefined; }
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; }
  catch { return undefined; }
}
export function assemblyDate(value?: string): string {
  if (!value) { return ''; }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Translate only known read-model enums; never infer approval or source from a filename. */
export function assemblyResourceLabel(group: 'source' | 'status' | 'trust', value: string): string {
  const labels: Readonly<Record<typeof group, Readonly<Record<string, string>>>> = {
    source: { file: '文件', directory: '文件夹', archive: '压缩包', external: '外部文件', url: '网页链接' },
    status: { pending: '待解析', ready: '已解析', partial: '部分解析', failed: '解析失败' },
    trust: { untrusted: '未经审核', reviewed: '已审核', trusted: '已信任' },
  };
  return labels[group][value] ?? '未注明';
}
export function assemblyCaptureKindLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    web_page: '网页', web_image: '网页图片', web_selection: '网页摘录', web_link: '网页链接',
    local_file: '本地文件', screenshot: '截图', clipboard_image: '剪贴板图片', clipboard_text: '剪贴板文字',
    conversation_snapshot: '会话记录', image: '图片', text: '文字', url: '链接', local_path: '本地文件',
  };
  return labels[kind] ?? '未命名收件';
}
