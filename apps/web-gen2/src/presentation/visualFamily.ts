// Visual family resolver (Phase A audit P1 / B00-R3) — lifted from Gen1
// `features/presentation/visualFamily.ts`, corrected to consume CORE metadata
// (kind / mimeType / sourceKind) instead of guessing from title, id prefixes
// or paths. Pure function, fully testable.
//
// LcosVisualFamily:
//   text | document | image | web | audio | video | conversation | skill |
//   run | output | unknown
//
// Rules (frozen):
//   - entityType conversation/skill/run wins over any file guess.
//   - managed run output -> 'output'.
//   - MIME and artifact kind are the only file signals; a title that contains
//     'pdf'/'skill'/'run' NEVER changes the family.

import type { AgentCreatableNodeType } from '../spatial/types.js';

export type LcosVisualFamily =
  | 'text'
  | 'document'
  | 'image'
  | 'web'
  | 'audio'
  | 'video'
  | 'conversation'
  | 'skill'
  | 'run'
  | 'output'
  | 'unknown';


export interface VisualFamilySource {
  readonly entityType?: 'artifact' | 'conversation' | 'skill' | 'run' | string;
  readonly artifactKind?: 'text' | 'image' | 'pdf' | 'file' | 'presentation' | 'markdown' | string;
  readonly mimeType?: string;
  readonly sourceKind?: string;
  readonly sourceRunId?: string;
  readonly managed?: boolean;
}

function normMime(mime?: string): string {
  return ((mime ?? '').toLowerCase().split(';', 1)[0] ?? '').trim();
}

/**
 * Resolve the visual family from authoritative Core/Projection metadata.
 * Never uses title or id prefixes.
 */
export function resolveVisualFamily(source: VisualFamilySource): LcosVisualFamily {
  if (source.entityType === 'conversation') return 'conversation';
  if (source.entityType === 'skill') return 'skill';
  if (source.entityType === 'run') return 'run';
  if (source.sourceRunId && source.managed) return 'output';

  const mime = normMime(source.mimeType);
  const kind = source.artifactKind;

  // A selected revision's normalized MIME is the precise content signal.
  // Artifact kind is the fallback when no FileRecord MIME is available.
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (kind === 'image') return 'image';
  if (source.sourceKind === 'url' || source.sourceKind === 'web' || kind === 'link') return 'web';
  if (
    mime === 'application/pdf' ||
    kind === 'pdf' ||
    kind === 'presentation' ||
    kind === 'markdown' ||
    (kind === 'file' && mime.startsWith('text/'))
  ) return 'document';
  if (kind === 'text' || mime === 'text/plain' || mime.startsWith('text/')) return 'text';
  return 'unknown';
}

/** Map a visual family to a Huabu NATIVE node type (B00-R4). No lcos/* synonyms. */
export function huabuNodeTypeForFamily(family: LcosVisualFamily): AgentCreatableNodeType {
  switch (family) {
    case 'image': return 'image';
    case 'document':
      return 'note'; // pdf/preview shape comes from Huabu preview, body stays native
    /*
     * R2（2026-09-14 用户裁决 B）：「Core 投影默认只读」。
     * 文本族 Core 投影必须进入统一 NodePresentation Junction —— 只有 `note` 家族会被
     * NodeWrapper/NoteNode 交给 junction，`text` 家族（TextNode）不消费 junction，
     * 于是 Core 投影会显示成一块**空的、可就地编辑的占位编辑器**（首屏空 `Type…`）。
     * 因此文本族 Core 投影改用 `note`：由 LCOS 物种 body 呈现标题 + 真实次级行，
     * 打开/编辑走 Reader 或 Professional Work View。
     * 未绑定 Core 的 Huabu 原生自由文本仍是 `text`（不在本函数管辖内），保持就地编辑。
     */
    case 'text': return 'note';
    case 'web': return 'web';
    // Huabu exposes audio as a canvas node, but does not allow it through the
    // agent CREATE_NODES contract. Keep the audio morphology while using the
    // existing neutral note host for Core projections.
    case 'audio': return 'note';
    case 'video': return 'video';
    case 'conversation':
    case 'skill':
    case 'run':
    case 'output':
    case 'unknown':
    default:
      return 'note';
  }
}
