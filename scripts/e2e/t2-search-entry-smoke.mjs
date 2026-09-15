import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const shots = resolve('.e2e-data/shots');
mkdirSync(shots, { recursive: true });
await runScenario({
  name: 'T2-search-entry',
  baseUrl: 'http://127.0.0.1:5173',
  async body(h) {
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('[data-lcos-navigator-island]');
    await h.requireSelector('.react-flow');
    await h.page.waitForFunction(() => document.querySelectorAll('[data-lcos-host-surface]').length > 0);
    await h.page.waitForFunction(() => [...document.querySelectorAll('[data-lcos-host-surface]')]
      .every((host) => {
        const body = host.closest('.react-flow__node')?.querySelector('[data-lcos-species-body]');
        return body && body.getBoundingClientRect().height > 0;
      }));
    await h.page.keyboard.press('Control+f');
    const input = h.page.locator('[data-lcos-navigator-island] input');
    await input.waitFor({ state: 'visible' });
    await input.fill('资料');
    await h.requireSelector('[data-lcos-navigator-results]');
    await h.page.waitForFunction(() => {
      const results = document.querySelector('[data-lcos-navigator-results]');
      return results && !results.textContent.includes('正在搜索');
    });
    h.requireTrue(!(await h.text('[data-lcos-navigator-island]')).includes('搜索失败'), 'Real Core search must succeed');
    await h.screenshot(resolve(shots, 't2-search-entry.png'));
    await input.fill('项目定位');
    const result = h.page.locator('[data-lcos-navigator-results] button').filter({ hasText: '项目定位' });
    await result.first().waitFor({ state: 'visible' });
    h.requireTrue((await result.count()) > 0, 'Existing Core artifact must be searchable');
    await h.screenshot(resolve(shots, 't2-search-real-result.png'));
    await h.page.keyboard.press('Escape');
    await input.waitFor({ state: 'detached' });
    h.requireEqual(await h.count('.react-flow'), 1, 'Closing search preserves the single canvas');
    await h.screenshot(resolve(shots, 't2-search-closed.png'));
    await h.page.locator('.react-flow__node').filter({ has: h.page.locator('[data-lcos-species-body]') }).first().click({ position: { x: 30, y: 15 } });
    await h.requireSelector('[data-lcos-action-arc]');
    h.requireEqual(await h.page.getByRole('button', { name: '在阅读器打开', exact: true }).count(), 1, 'Bound text exposes the existing Reader action');
    await h.page.keyboard.press('f');
    await h.requireSelector('[data-lcos-focus-where][data-open="true"]');
    const where = h.page.locator('[data-lcos-focus-where]');
    h.requireTrue(!(await where.innerText()).includes('读取失败'), 'Known identity uses real binding query');
    const go = where.getByRole('button', { name: '前往' });
    h.requireTrue((await go.count()) > 0, 'Existing cross-canvas bindings produce destinations');
    await h.screenshot(resolve(shots, 't2-where-real-locations.png'));
    await where.getByText('Context', { exact: true }).locator('..').locator('..').getByRole('button', { name: '前往' }).click();
    await h.page.waitForURL('**/context');
    await h.page.locator('[data-lcos-focus-where][data-open="false"]').waitFor({ state: 'attached' });
    await h.screenshot(resolve(shots, 't2-where-arrived.png'));
  },
});
