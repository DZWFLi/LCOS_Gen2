// S2b Figma Main source morphology — pure view contract tests.
// These tests verify exact Figma adoption markers and, more importantly, that
// Core visual families no longer collapse into one generic card.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LcosSpeciesBodyContent } from './LcosSpeciesBodies';

function renderSource(
  visualFamily: 'text' | 'document' | 'image' | 'audio',
  options: { preview?: string; mediaSrc?: string; durationSec?: number; worldWidth?: number } = {},
): string {
  return renderToStaticMarkup(
    <LcosSpeciesBodyContent
      species="source"
      title="测试对象"
      density="reading"
      secondary="真实次级行"
      preview={options.preview}
      mediaSrc={options.mediaSrc}
      durationSec={options.durationSec}
      worldWidth={options.worldWidth}
      visualFamily={visualFamily}
    />,
  );
}

describe('LcosSpeciesBodies / Main source morphology', () => {
  it('text → Figma 5388:102 typography object, not generic material card', () => {
    const html = renderSource('text', { preview: '越过边界，看见下一座山。' });
    expect(html).toContain('data-lcos-source-visual="text"');
    expect(html).toContain('data-figma-node-id="5388:102"');
    expect(html).toContain('越过边界，看见下一座山。');
    expect(html).not.toContain('>材料<');
  });

  it('document → Figma 5388:106 paper morphology with real preview', () => {
    const html = renderSource('document', { preview: '不是为了抵达更远，而是重新发现自己。' });
    expect(html).toContain('data-lcos-source-visual="document"');
    expect(html).toContain('data-figma-node-id="5388:106"');
    expect(html).toContain('不是为了抵达更远');
  });

  it('image → Figma 5388:98 media-first morphology and real src', () => {
    const html = renderSource('image', { mediaSrc: 'https://example.test/ridge.png' });
    expect(html).toContain('data-lcos-source-visual="image"');
    expect(html).toContain('data-figma-node-id="5388:98"');
    expect(html).toContain('src="https://example.test/ridge.png"');
  });

  it('audio → Figma 5388:121 waveform morphology, explicitly decorative', () => {
    const html = renderSource('audio', { durationSec: 38 });
    expect(html).toContain('data-lcos-source-visual="audio"');
    expect(html).toContain('data-figma-node-id="5388:121"');
    expect(html).toContain('data-lcos-waveform="exact"');
    expect(html).toContain('00:38');
    expect((html.match(/data-lcos-wave-bar/g) ?? [])).toHaveLength(64);
  });
});
