import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const shots = resolve('.e2e-data/shots');
mkdirSync(shots, { recursive: true });

await runScenario({
  name: 'LCOS-context-menu-shared-command-model',
  baseUrl: 'http://127.0.0.1:5173',
  async body(h) {
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('.react-flow');
    const node = h.page.locator('.react-flow__node').filter({
      has: h.page.locator('[data-lcos-species-body]'),
    }).first();
    await node.waitFor({ state: 'visible' });
    await node.click({ button: 'right', position: { x: 30, y: 15 } });
    await h.requireSelector('[data-lcos-context-menu]');
    h.requireTrue(
      (await h.page.locator('[data-lcos-context-command]').count()) > 0,
      'Context menu is populated from the shared node command model',
    );
    await h.screenshot(resolve(shots, 'lcos-context-menu.png'));
    await h.page.keyboard.press('Escape');
    h.requireEqual(
      await h.page.locator('[data-lcos-context-menu]').count(),
      0,
      'Escape closes the temporary context menu',
    );
  },
});
