#!/usr/bin/env node
/**
 * R1 浏览器证据（fail-fast harness）：
 *   A. dev gallery：八族 × 全部 variant 真的渲染出来（数量断言），
 *      双主题真的切换（计算样式变化），reduced-motion 真的生效（动画被取消）。
 *   B. 生产 Main：族属性在真实生产路由上出现（不是只在 gallery 里存在）。
 *
 * 用法（隔离环境先 up）：
 *   node scripts/e2e/r1-families-gallery.mjs
 * 环境变量：
 *   LCOS_E2E_WEB_URL（默认 http://localhost:5273）
 *   LCOS_E2E_PROJECT（默认 lcos-gen2-dev）
 *   LCOS_E2E_SHOT_DIR（默认 .e2e-data/shots）
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';
const SHOTS = resolve(process.env.LCOS_E2E_SHOT_DIR ?? '.e2e-data/shots');
mkdirSync(SHOTS, { recursive: true });

const EXPECTED = {
  sections: 8,
  navigatorVariants: 11,
  navigatorPins: 3, // 彩色标 + 搜索 两组样例，每组 3 个 Pin
  feedbackVariants: 7,
  taskVariants: 7,
  portalVariants: 6,
  windowLayouts: 3,
  collectionTiles: 9, // 事情/时间 × 总览/主画布/装配（6）+ 工作流跨视图 3
  railwayVariants: 2, // 目的地 1 / 4
  projectShellVariants: 3,
};

const gallery = await runScenario({
  name: 'R1-gallery-families',
  baseUrl: BASE,
  async body(h) {
    await h.goto('/playground/lcos-families');
    await h.requireSelector('[data-lcos-gallery]');

    // ---- 八族都在 gallery 里 ----
    h.requireEqual(await h.count('[data-lcos-gallery-section]'), EXPECTED.sections, 'gallery 分区数');

    // ---- 每族的 variant 数量与 Figma 母表一致 ----
    h.requireEqual(
      await h.count('[data-lcos-family="navigator-island"]'),
      EXPECTED.navigatorVariants,
      'NavigatorIsland 变体数',
    );
    h.requireEqual(await h.count('[data-lcos-pin-mark]'), EXPECTED.navigatorPins * 2, 'NavigatorIsland Pin 角标数');
    h.requireEqual(
      await h.count('[data-lcos-family="surface-feedback"]'),
      EXPECTED.feedbackVariants,
      'SurfaceFeedback 变体数',
    );
    h.requireEqual(await h.count('[data-lcos-family="task-card"]'), EXPECTED.taskVariants, 'TaskCard 变体数');
    h.requireEqual(
      await h.count('[data-lcos-family="portal-preview"]'),
      EXPECTED.portalVariants,
      'Portal 变体数',
    );
    h.requireEqual(
      await h.count('[data-lcos-family="window-chrome"]'),
      EXPECTED.windowLayouts,
      'WindowChrome 布局数',
    );
    h.requireEqual(
      await h.count('[data-lcos-family="collection-surface"]'),
      EXPECTED.collectionTiles,
      'Collection 体块数',
    );
    h.requireEqual(await h.count('[data-lcos-family="railway"]'), EXPECTED.railwayVariants, 'Railway 变体数');
    h.requireEqual(
      await h.count('[data-lcos-family="project-shell"]'),
      EXPECTED.projectShellVariants,
      'ProjectShell 现场数',
    );
    h.requireEqual(
      await h.count('[data-lcos-family="railway"][data-lcos-variant-count="1"]'),
      1,
      'Railway 目的地=1 存在',
    );
    h.requireEqual(
      await h.count('[data-lcos-family="railway"][data-lcos-variant-count="4"]'),
      1,
      'Railway 目的地=4 存在',
    );
    // 12 个「状态型」变体必须真的被渲染成不同 data-lcos-variant
    const navVariants = await h.evaluate(() =>
      Array.from(document.querySelectorAll('[data-lcos-family="navigator-island"]')).map((el) =>
        el.getAttribute('data-lcos-variant'),
      ),
    );
    h.requireEqual(new Set(navVariants).size, EXPECTED.navigatorVariants, 'NavigatorIsland 变体取值唯一数');
    h.requireTrue(navVariants.includes('degraded'), '缺 degraded 变体');
    h.requireTrue(navVariants.includes('selected'), '缺 selected 变体');

    // ---- 几何：静息 52×48、搜索 402×48（Figma structures/navigator 实测） ----
    const navGeom = await h.evaluate(() => {
      const pick = (v) =>
        document.querySelector(`[data-lcos-family="navigator-island"][data-lcos-variant="${v}"]`);
      const box = (el) => {
        const r = el?.getBoundingClientRect();
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      };
      return { resting: box(pick('静息')), search: box(pick('搜索')), painted: box(pick('彩色标')) };
    });
    h.requireEqual(navGeom.resting?.w, 52, 'NavigatorIsland 静息宽');
    h.requireEqual(navGeom.resting?.h, 48, 'NavigatorIsland 静息高');
    h.requireEqual(navGeom.search?.w, 402, 'NavigatorIsland 搜索宽');
    h.requireEqual(navGeom.painted?.w, 184, 'NavigatorIsland 彩色标宽');

    // ---- 几何：Railway 1/4、Collection 248×244、TaskCard 224×324、Portal 440×360 ----
    const geom = await h.evaluate(() => {
      const box = (sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      };
      return {
        railway1: box('[data-lcos-family="railway"][data-lcos-variant-count="1"]'),
        railway4: box('[data-lcos-family="railway"][data-lcos-variant-count="4"]'),
        collection: box('[data-lcos-family="collection-surface"]'),
        task: box('[data-lcos-family="task-card"]'),
        portal: box('[data-lcos-family="portal-preview"]'),
      };
    });
    h.requireEqual(geom.railway1?.h, 52, 'Railway 目的地=1 高');
    h.requireEqual(geom.railway4?.h, 178, 'Railway 目的地=4 高');
    h.requireEqual(geom.railway1?.w, 52, 'Railway 宽');
    h.requireEqual(geom.collection?.w, 248, 'Collection 体块宽');
    h.requireEqual(geom.collection?.h, 244, 'Collection 体块高');
    h.requireEqual(geom.task?.w, 224, 'TaskCard 宽');
    h.requireEqual(geom.task?.h, 324, 'TaskCard 高');
    h.requireEqual(geom.portal?.w, 440, 'Portal 预览宽');
    h.requireEqual(geom.portal?.h, 360, 'Portal 预览高');

    await h.screenshot(resolve(SHOTS, 'r1-gallery-light.png'));

    // ---- 双主题：切换 .dark 后画布底色必须真的变（token 双值生效） ----
    const before = await h.evaluate(
      () => getComputedStyle(document.querySelector('[data-lcos-gallery]')).backgroundColor,
    );
    await h.page.click('[data-lcos-gallery-theme-toggle]');
    await h.wait(120);
    const after = await h.evaluate(
      () => getComputedStyle(document.querySelector('[data-lcos-gallery]')).backgroundColor,
    );
    h.requireTrue(before !== after, `深色切换后底色未变（${before} → ${after}）`);
    h.requireEqual(
      await h.evaluate(() => document.documentElement.classList.contains('dark')),
      true,
      'html 应带上 dark 类',
    );
    await h.screenshot(resolve(SHOTS, 'r1-gallery-dark.png'));
    await h.page.click('[data-lcos-gallery-theme-toggle]');

    // ---- reduced-motion：loading 变体的呼吸动画必须被取消 ----
    await h.page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await h.evaluate(() => {
      const el = document.querySelector('[data-lcos-family="navigator-island"][data-lcos-variant="loading"]');
      const pulse = document.querySelector('.lcos-static-pulse');
      return {
        island: el ? getComputedStyle(el).animationName : null,
        pulse: pulse ? getComputedStyle(pulse).animationName : null,
      };
    });
    h.requireTrue(reduced.island === 'none', `reduced-motion 下 NavigatorIsland loading 仍有动画：${reduced.island}`);
    h.requireTrue(reduced.pulse === 'none', `reduced-motion 下 lcos-static-pulse 仍有动画：${reduced.pulse}`);
    await h.page.emulateMedia({ reducedMotion: 'no-preference' });
  },
});

const production = await runScenario({
  name: 'R1-production-families',
  baseUrl: BASE,
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });

    // ProjectShell 现场变体
    h.requireEqual(
      await h.page.getAttribute('[data-lcos-project-shell]', 'data-lcos-variant'),
      'main',
      'ProjectShell 现场变体',
    );
    // NavigatorIsland 族（真实生产容器）
    await h.requireSelector('[data-lcos-family="navigator-island"]');
    // Railway 族
    await h.requireSelector('[data-lcos-family="railway"]');
    const railCount = await h.page.getAttribute('[data-lcos-family="railway"]', 'data-lcos-variant-count');
    h.requireEqual(railCount, '3', '生产 Railway 目的地数（三现场）');

    await h.screenshot(resolve(SHOTS, 'r1-production-main-1440.png'));
  },
});

console.log(
  JSON.stringify(
    {
      ok: gallery.ok && production.ok,
      expected: EXPECTED,
      scenarios: [gallery.scenario, production.scenario],
      shots: [
        resolve(SHOTS, 'r1-gallery-light.png'),
        resolve(SHOTS, 'r1-gallery-dark.png'),
        resolve(SHOTS, 'r1-production-main-1440.png'),
      ],
    },
    null,
    2,
  ),
);
