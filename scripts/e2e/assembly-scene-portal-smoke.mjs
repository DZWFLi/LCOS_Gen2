import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const shots = resolve('.e2e-data/shots');
mkdirSync(shots, { recursive: true });
await runScenario({
  name: 'Assembly-scene-Portal',
  baseUrl: 'http://127.0.0.1:5173',
  async body(h) {
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('[data-lcos-species-body]');
    await h.page.locator('[data-lcos-assembly-entry]').click();
    const scene = h.page.locator('[data-lcos-assembly-item-kind="scene"]').first();
    await scene.waitFor({ state: 'visible' });
    await scene.hover();
    const beforeUrl = h.page.url();
    const beforeCamera = await h.page.locator('.react-flow__viewport').getAttribute('style');
    await scene.getByRole('button', { name: '预览现场', exact: true }).click();
    await h.requireSelector('[data-lcos-real-portal-preview]');
    h.requireEqual(h.page.url(), beforeUrl, 'Preview must not navigate to a child canvas');
    h.requireEqual(await h.page.locator('.react-flow__viewport').getAttribute('style'), beforeCamera, 'Preview must leave host camera unchanged');
    await h.screenshot(resolve(shots, 'assembly-scene-portal.png'));
  },
});
