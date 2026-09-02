// A01 — LcosCanvasAdapter: HostSeam descriptors -> Huabu Canvas host extension.
// Runs on node:test via tsx; React is type-only here (no runtime import).

import assert from 'node:assert/strict';
import test from 'node:test';

import { createHostSeam, hostExtensionFromSeam } from '../src/index.js';
import type { HostSeam } from '../src/index.js';

const fakeHost = {} as Parameters<typeof createHostSeam>[0];

function bareSeam(overrides: Partial<HostSeam> = {}): HostSeam {
  const seam = createHostSeam(fakeHost);
  return { ...seam, ...overrides };
}

test('hostExtensionFromSeam: empty seam collapses to a stock extension', () => {
  const ext = hostExtensionFromSeam(bareSeam());
  assert.equal(ext.nodeTypes, undefined);
  assert.equal(ext.overlays, undefined);
  assert.equal(ext.recognizers, undefined);
});

test('hostExtensionFromSeam: renderer descriptors become a nodeTypes record', () => {
  const rendererA = { tag: 'A' };
  const rendererB = { tag: 'B' };
  const ext = hostExtensionFromSeam(
    bareSeam({
      extraRenderers: [
        { nodeType: 'lcos/artifact', renderer: rendererA },
        { nodeType: 'lcos/conversation', renderer: rendererB },
      ],
    }),
  );
  assert.deepEqual(Object.keys(ext.nodeTypes ?? {}).sort(), [
    'lcos/artifact',
    'lcos/conversation',
  ]);
  assert.equal(ext.nodeTypes?.['lcos/artifact'], rendererA);
  assert.equal(ext.nodeTypes?.['lcos/conversation'], rendererB);
});

test('hostExtensionFromSeam: overlays keep their stable keys', () => {
  const overlayNode = { element: 'div' };
  const ext = hostExtensionFromSeam(
    bareSeam({
      overlays: [
        { key: 'lcos/drop-preview', node: overlayNode },
        { key: 'lcos/host-overlay', node: overlayNode },
      ],
    }),
  );
  assert.equal(ext.overlays?.length, 2);
  assert.equal(ext.overlays?.[0]?.key, 'lcos/drop-preview');
  assert.equal(ext.overlays?.[1]?.key, 'lcos/host-overlay');
  assert.equal(ext.overlays?.[0]?.node, overlayNode);
});

test('hostExtensionFromSeam: mixed content passes renderer identity through unchanged', () => {
  // Opaque descriptors must round-trip by reference — the adapter never
  // reconstructs renderers (React would see a new component type each call
  // and remount every node).
  const renderer = () => null;
  const ext1 = hostExtensionFromSeam(
    bareSeam({ extraRenderers: [{ nodeType: 'lcos/artifact', renderer }] }),
  );
  const ext2 = hostExtensionFromSeam(
    bareSeam({ extraRenderers: [{ nodeType: 'lcos/artifact', renderer }] }),
  );
  assert.equal(ext1.nodeTypes?.['lcos/artifact'], renderer);
  assert.equal(ext2.nodeTypes?.['lcos/artifact'], renderer);
});

test('createHostSeam: injected renderers/overlays are exposed on the seam', () => {
  const renderer = () => null;
  const seam = createHostSeam(fakeHost, {
    renderers: [{ nodeType: 'lcos/artifact', renderer }],
    overlays: [{ key: 'lcos/test', node: { element: 'div' } }],
  });
  assert.equal(seam.extraRenderers.length, 1);
  assert.equal(seam.extraRenderers[0]?.nodeType, 'lcos/artifact');
  assert.equal(seam.overlays.length, 1);
  assert.equal(seam.overlays[0]?.key, 'lcos/test');
  // connectIntent stays wired (kind fallback until A05 capability resolution).
  assert.equal(seam.connectIntent.kind, 'references');
});
