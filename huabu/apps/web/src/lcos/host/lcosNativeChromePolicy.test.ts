import { describe, expect, it } from 'vitest';

import { canvasChromePolicy } from './lcosNativeChromePolicy';

describe('canvasChromePolicy', () => {
  it('lcos mode hides product chrome but keeps selection toolbars', () => {
    const p = canvasChromePolicy('lcos');
    expect(p.nodeToolbarVisible).toBe(false);
    expect(p.controlsVisible).toBe(false);
    expect(p.miniMapVisible).toBe(false);
    expect(p.selectionToolbarsVisible).toBe(true);
  });

  it('huabu mode keeps everything visible', () => {
    const p = canvasChromePolicy('huabu');
    expect(p.nodeToolbarVisible).toBe(true);
    expect(p.controlsVisible).toBe(true);
    expect(p.miniMapVisible).toBe(true);
    expect(p.selectionToolbarsVisible).toBe(true);
  });
});