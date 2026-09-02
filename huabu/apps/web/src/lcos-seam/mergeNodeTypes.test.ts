import { describe, expect, it, vi, afterEach } from 'vitest';

import { mergeNodeTypes } from './mergeNodeTypes';
import type { ExternalNodeRenderer } from './types';

const FakeRenderer = (() => null) as unknown as ExternalNodeRenderer;
const OtherRenderer = (() => null) as unknown as ExternalNodeRenderer;

const builtIn: Readonly<Record<string, ExternalNodeRenderer>> = {
  text: FakeRenderer,
  note: FakeRenderer,
  image: FakeRenderer,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeNodeTypes', () => {
  it('returns the built-in map unchanged when no extension is given', () => {
    expect(mergeNodeTypes(builtIn, undefined)).toBe(builtIn);
    expect(mergeNodeTypes(builtIn, undefined, { isDev: true })).toBe(builtIn);
  });

  it('merges namespaced host renderers alongside built-ins', () => {
    const merged = mergeNodeTypes(builtIn, {
      'lcos/artifact': OtherRenderer,
    });
    expect(merged['lcos/artifact']).toBe(OtherRenderer);
    expect(merged.text).toBe(builtIn.text);
    expect(merged.note).toBe(builtIn.note);
    expect(Object.keys(merged)).toHaveLength(4);
  });

  it('throws in dev when a host key collides with a built-in', () => {
    expect(() =>
      mergeNodeTypes(builtIn, { text: OtherRenderer }, { isDev: true }),
    ).toThrowError(/collides with a Huabu built-in/);
  });

  it('refuses the override (warn + keep built-in) in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const merged = mergeNodeTypes(builtIn, {
      text: OtherRenderer,
      'lcos/artifact': OtherRenderer,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('refusing to override built-in node type "text"'),
    );
    // Built-in kept, non-colliding key still merged.
    expect(merged.text).toBe(builtIn.text);
    expect(merged['lcos/artifact']).toBe(OtherRenderer);
  });

  it('never lets an external renderer replace a built-in in any mode', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const isDev of [false, true]) {
      try {
        mergeNodeTypes(builtIn, { note: OtherRenderer }, { isDev });
      } catch {
        // dev throws — that is also "refused"
      }
      // Re-merge with no collision to confirm built-ins are untouched.
      const merged = mergeNodeTypes(builtIn, { 'lcos/x': OtherRenderer });
      expect(merged.note).toBe(builtIn.note);
    }
  });
});
