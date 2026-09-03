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
  return (mime ?? '').toLowerCase().trim();
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

  if (kind === 'image' || mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
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
export function huabuNodeTypeForFamily(family: LcosVisualFamily): string {
  switch (family) {
    case 'image': return 'image';
    case 'document':
      return 'note'; // pdf/preview shape comes from Huabu preview, body stays native
    case 'text': return 'text';
    case 'web': return 'web';
    case 'audio': return 'audio';
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
