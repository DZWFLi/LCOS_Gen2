import type { LcosVisualFamily, PresentationDensity } from '@local-creative-os/web-gen2';

export interface SourceMorphologyProps {
  readonly family: LcosVisualFamily;
  readonly title: string;
  readonly secondary?: string;
  readonly preview?: string;
  readonly mediaSrc?: string;
  readonly durationSec?: number;
  readonly density: PresentationDensity;
  readonly worldWidth?: number;
}
