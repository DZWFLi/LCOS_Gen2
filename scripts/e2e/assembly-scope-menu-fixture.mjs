// UI-only fixture: supplies a scope item linked to existing read-only Workspace
// records. Does not write Core or claim production Context creation is complete.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const shots = resolve('.e2e-data/shots');
mkdirSync(shots, { recursive: true });
await runScenario({
  name: 'Assembly-scope-menu-UI-fixture',
  baseUrl: 'http://127.0.0.1:5173',
  async body(h) {
    let candidates = [];
    await h.page.route('**/projects/lcos-gen2-dev/warehouse', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const sitesResponse = await route.fetch({ url: route.request().url().replace('/warehouse', '/workspaces') });
      const sites = (await sitesResponse.json()).value;
      const scopeId = sites[0].scopeId;
      candidates = sites.filter((site) => site.scopeId === scopeId && site.canvasId);
      json.value.items.push({ schemaVersion: 1, entityRef: { type: 'context', id: scopeId },
        kind: 'context', title: '[UI fixture] 多现场集合', usageCount: 0 });
      await route.fulfill({ response, json });
    });
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('[data-lcos-species-body]');
    await h.page.locator('[data-lcos-assembly-entry]').click();
    const item = h.page.locator('[data-lcos-assembly-item-kind="context"]').filter({ hasText: '[UI fixture]' });
    await item.waitFor({ state: 'visible' });
    await item.hover();
    await item.getByRole('button', { name: '选择现场预览' }).click();
    h.requireTrue(candidates.length > 1, 'Fixture has multiple real Workspace candidates');
    await h.page.getByRole('menuitem', { name: candidates[1].name, exact: true }).waitFor({ state: 'visible' });
    await h.screenshot(resolve(shots, 'assembly-scope-menu-fixture.png'));
    await h.page.keyboard.press('Escape');
    h.requireEqual(await h.page.getByRole('menuitem').count(), 0, 'Escape closes only the target menu');
    await item.waitFor({ state: 'visible' });
    await item.hover();
    await item.getByRole('button', { name: '选择现场预览' }).click();
    await h.page.getByRole('menuitem', { name: candidates[1].name, exact: true }).click();
    const targetPreview = h.page.waitForResponse((response) => response.url().includes(candidates[1].canvasId) && response.url().includes('preview'));
    await h.page.getByRole('menuitem', { name: '预览现场', exact: true }).click();
    const response = await targetPreview;
    h.requireTrue(response.ok(), 'Selected Workspace preview request succeeds');
    await h.requireSelector('[data-lcos-real-portal-preview]');
    h.requireTrue(h.page.url().endsWith('/main'), 'Selecting a preview does not navigate Main');

    // The same exact candidate also exposes child-worksite entry. This is a
    // route change, unlike preview, and carries the explicit workspace id.
    await h.page.locator('[data-lcos-assembly-entry]').click();
    await item.waitFor({ state: 'visible' });
    await item.hover();
    await item.getByRole('button', { name: '选择现场预览' }).click();
    await h.page.getByRole('menuitem', { name: candidates[1].name, exact: true }).click();
    await h.page.getByRole('menuitem', { name: '进入现场', exact: true }).click();
    await h.page.waitForURL('**/projects/lcos-gen2-dev/context?workspaceId=*');
    await h.requireSelector('[data-lcos-child-return]');
    h.requireTrue(await h.has(`[data-lcos-canvas-id="${candidates[1].canvasId}"]`), 'Child route uses the selected workspace canvas');
    await h.page.locator('[data-lcos-child-return]').click();
    await h.page.waitForURL('**/projects/lcos-gen2-dev/main');
    await h.wait(600);
    h.requireTrue(await h.has('[data-lcos-worksite-stage="main"]'), 'Child route returns to source Main');
  },
});
