// R0-5 反证：证明 harness 在真实失败时返回非零退出码。
//
//   node scripts/e2e/r0-harness-selftest.mjs ok      → exit 0（真实选择器 + 无错误）
//   node scripts/e2e/r0-harness-selftest.mjs missing → exit 1（不存在选择器）
//   node scripts/e2e/r0-harness-selftest.mjs error   → exit 1（页面 console error）
//
// 只读页面，不点击、不改数据。

import { runScenario } from './_harness.mjs';

const mode = process.argv[2] ?? 'ok';

await runScenario({
  name: `r0-harness-selftest:${mode}`,
  body: async (h) => {
    await h.goto('/projects/lcos-gen2-dev/main');
    await h.requireSelector('.react-flow', { timeout: 40000 });
    await h.wait(6000);

    if (mode === 'ok') {
      h.requireTrue(await h.has('[data-lcos-project-shell]'), 'LCOS shell 未渲染');
      h.requireNonEmpty(await h.count('.react-flow__node'), '画布上没有任何节点');
      return;
    }
    if (mode === 'missing') {
      await h.requireSelector('[data-lcos-selftest-missing-selector]', { timeout: 1500 });
      return;
    }
    if (mode === 'error') {
      await h.evaluate(() => console.error('[e2e-selftest] injected console error'));
      await h.wait(300);
      return;
    }
    throw new Error(`未知模式：${mode}`);
  },
});
