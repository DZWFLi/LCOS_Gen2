// Identity smoke: verifies an explicit workspaceId opens the requested Huabu
// canvas and the shell offers a safe return even when no same-tab source exists.
import { runScenario } from './_harness.mjs';

await runScenario({
  name: 'child-workspace-route-identity',
  baseUrl: 'http://127.0.0.1:5173',
  async body(h) {
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('[data-lcos-worksite-stage="main"]');
    await h.goto('/projects/lcos-gen2-dev/context?workspaceId=workspace-real-context');
    await h.requireSelector('[data-lcos-context-worksite]');
    await h.requireSelector('[data-lcos-child-return]');
    h.requireTrue(await h.has('[data-lcos-canvas-id="canvas-d5d9a153-1c39-4410-b8b8-5228f93485a3"]'), 'child route loads the exact workspace canvas');
    await h.page.locator('[data-lcos-child-return]').click();
    await h.page.waitForURL('**/projects/lcos-gen2-dev/main');
    await h.wait(1200);
    h.requireTrue(await h.has('[data-lcos-worksite-stage="main"]'), 'return falls back to Main when direct child URL has no source snapshot');
  },
});
