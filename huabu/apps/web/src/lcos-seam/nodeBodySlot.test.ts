import { describe, expect, it } from 'vitest';

import { isNativeAccentSurfaceEnabled } from './nodeBodySlot';

describe('native accent surface ownership', () => {
  it('keeps the native fallback and card host, and delegates every other host surface', () => {
    expect(isNativeAccentSurfaceEnabled(undefined)).toBe(true);
    expect(isNativeAccentSurfaceEnabled({ surface: 'card', showAiBadge: true, allowOverflow: false })).toBe(true);
    expect(isNativeAccentSurfaceEnabled({ surface: 'transparent', showAiBadge: false, allowOverflow: true })).toBe(false);
    expect(isNativeAccentSurfaceEnabled({ surface: 'paper', showAiBadge: false, allowOverflow: true })).toBe(false);
    expect(isNativeAccentSurfaceEnabled({ surface: 'media', showAiBadge: false, allowOverflow: true })).toBe(false);
  });
});
