// Failure injection only: intercept GET; no canvas creation or data writes.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runScenario } from './_harness.mjs';

const shots = resolve('.e2e-data/shots');
mkdirSync(shots, { recursive: true });
await runScenario({
  name: 'Worksite-load-failure-and-retry',
  baseUrl: 'http://127.0.0.1:5173',
  allowHttp: [403, 500],
  allowConsoleErrorsMatching: [/Failed to load resource:.*(?:403|500)/, /Failed to load canvas:/],
  async body(h) {
    const sitesResponse = h.page.waitForResponse((r) => r.url().endsWith('/projects/lcos-gen2-dev/workspaces') && r.ok());
    await h.goto('/projects/lcos-gen2-dev/main');
    const sites = (await (await sitesResponse).json()).value;
    const context = sites.find((s) => s.preferredSurface === 'context');
    h.requireNonEmpty(context?.canvasId, 'Real Context canvas exists');
    await h.requireSelector('[data-lcos-species-body]');
    const snapshot = () => h.page.evaluate(() => ({
      canvasId: document.querySelector('[data-lcos-canvas-id]')?.getAttribute('data-lcos-canvas-id'),
      nodeIds: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')).sort().join(','),
    }));
    const before = await snapshot();
    const url = h.page.url();
    const failTarget = `**/canvas/${context.canvasId}`;
    await h.page.route(failTarget, (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: '测试：目标现场暂不可读取' }) })
      : route.continue());
    await h.page.locator('[data-lcos-surface="context"]').click();
    const alert = h.page.getByRole('alert').filter({ hasText: '目标现场暂不可读取' });
    await alert.waitFor({ state: 'visible' });
    const box = await alert.boundingBox();
    h.requireTrue(Boolean(box && box.y >= 0 && box.height > 0), 'Failure is visible above Dock, not clipped');
    h.requireEqual(h.page.url(), url, 'Failed switch preserves current route');
    const failed = await snapshot();
    h.requireEqual(failed.canvasId, before.canvasId, 'Failed switch preserves source identity');
    h.requireEqual(failed.nodeIds, before.nodeIds, 'Failed switch preserves source content');
    h.requireNonEmpty(failed.canvasId, 'Failure exits loading and restores the source stage');
    h.requireEqual(await h.count('[data-lcos-recover-canvas]'), 0, 'Permission failure never offers recreation');
    await h.screenshot(resolve(shots, 'worksite-switch-failure.png'));
    await h.page.unroute(failTarget);
    await h.page.locator('[data-lcos-surface="context"]').click();
    await h.page.waitForURL('**/context');
    await h.requireSelector('[data-lcos-worksite-stage="context"]');
    h.requireEqual((await snapshot()).canvasId, context.canvasId, 'Retry loads the actual target');

    // Direct entry has no source page to keep displaying, so it needs a retry panel.
    await h.page.route(failTarget, (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '测试：服务暂时不可用' }) })
      : route.continue());
    await h.page.reload({ waitUntil: 'domcontentloaded' });
    await h.requireSelector('[data-lcos-worksite-load-error]');
    h.requireEqual(await h.count('[data-lcos-recover-canvas]'), 0, 'Server failure is not canvas loss');
    await h.screenshot(resolve(shots, 'worksite-direct-load-failure.png'));
    await h.page.unroute(failTarget);
    await h.page.getByRole('button', { name: '重试加载', exact: true }).click();
    await h.requireSelector('[data-lcos-worksite-stage="context"]');
    h.requireEqual((await snapshot()).canvasId, context.canvasId, 'Direct-entry retry reaches the real canvas');
  },
});
