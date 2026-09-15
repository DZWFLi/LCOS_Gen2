import {
  resolveVisualFamily,
  type LcosVisualFamily,
  type VisualFamilySource,
} from './visualFamily.js';

export type LcosHostSurface = 'transparent' | 'paper' | 'media' | 'card';

/**
 * Presentation-only instructions consumed by the existing Huabu NodeWrapper.
 * They never own selection/drag/resize/geometry truth; they only remove native
 * chrome that would visually contradict an LCOS replacement body.
 */
export interface LcosNodeHostPresentation {
  readonly surface: LcosHostSurface;
  readonly showAiBadge: boolean;
  readonly allowOverflow: boolean;
}

/**
 * Initial geometry for a NEW projection only. Existing bound Huabu nodes keep
 * their persisted geometry forever. For adopted LCOS species this Figma preset
 * is the new-projection visual contract; Core ArtifactView size is only fallback
 * when no exact preset exists.
 */
export interface LcosInitialGeometryPreset {
  readonly width: number;
  readonly height: number;
  readonly figmaNodeId: string;
}

export interface LcosGeometryPresentationSource extends VisualFamilySource {
  readonly displayMode?: 'card' | 'thumbnail' | 'compact' | string;
}

const HOST_BY_FAMILY: Readonly<
  Partial<Record<LcosVisualFamily, LcosNodeHostPresentation>>
> = {
  text: { surface: 'transparent', showAiBadge: false, allowOverflow: true },
  document: { surface: 'paper', showAiBadge: false, allowOverflow: true },
  image: { surface: 'media', showAiBadge: false, allowOverflow: true },
  audio: { surface: 'transparent', showAiBadge: false, allowOverflow: true },
  conversation: { surface: 'transparent', showAiBadge: false, allowOverflow: true },
};

const GEOMETRY_BY_FAMILY: Readonly<
  Partial<Record<LcosVisualFamily, LcosInitialGeometryPreset>>
> = {
  text: { width: 385, height: 142, figmaNodeId: '5388:102' },
  document: { width: 206, height: 154, figmaNodeId: '5388:106' },
  image: { width: 410, height: 273, figmaNodeId: '5388:98' },
  audio: { width: 171, height: 96, figmaNodeId: '5388:121' },
  conversation: { width: 121, height: 142, figmaNodeId: '5388:118' },
};

export function resolveLcosNodeHostPresentation(
  source: VisualFamilySource,
): LcosNodeHostPresentation | undefined {
  const family = resolveVisualFamily(source);
  return HOST_BY_FAMILY[family];
}

export function resolveLcosInitialGeometryPreset(
  source: LcosGeometryPresentationSource,
): LcosInitialGeometryPreset | undefined {
  const family = resolveVisualFamily(source);
  if (family === 'image' && source.displayMode === 'thumbnail') {
    return { width: 205, height: 127, figmaNodeId: '5388:111' };
  }
  return GEOMETRY_BY_FAMILY[family];
}
