// R1 接线（wiring）测试：共享族必须**同时**被 dev gallery 与生产文件真正 import，
// 否则「组件族建好了但没人用」就会以绿测通过。这是 R1 退出条件在测试层的对照。
// 纯源码一致性检查（不做渲染），因此不依赖任何运行时。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// vitest（Node 22）下 import.meta.url 在部分 inline 场景不是 file: scheme，
// 这里用 dirname 直取，避免 fileURLToPath 抛 "URL must be of scheme file"。
const MODULE_DIR = (import.meta as unknown as { dirname?: string }).dirname ?? process.cwd();
const LCOS_ROOT = resolve(MODULE_DIR, '..', '..'); // .../src/lcos
const GALLERY = join(LCOS_ROOT, 'dev', 'LcosFamiliesGalleryPage.tsx');

const read = (p: string): string => readFileSync(p, 'utf8');

/** 族 → gallery 里的使用点 + 生产 owner 文件 + 该文件里必须出现的族标记。 */
const FAMILIES: Readonly<
  Record<string, { galleryUsage: string; owner: string; ownerMarker: string }>
> = {
  ProjectShell: {
    galleryUsage: '<LcosProjectShell',
    owner: 'shell/LcosProjectShell.tsx',
    ownerMarker: 'data-lcos-family="project-shell"',
  },
  NavigatorIsland: {
    galleryUsage: '<LcosNavigatorIslandView',
    owner: 'navigation/LcosNavigatorIsland.tsx',
    ownerMarker: '<LcosNavigatorIslandView',
  },
  Railway: {
    galleryUsage: '<LcosRailwayView',
    owner: 'shell/LcosRailway.tsx',
    ownerMarker: '<LcosRailwayView',
  },
  ProfessionalWindowChrome: {
    galleryUsage: '<LcosWindowChrome',
    owner: 'professional/ProfessionalWindowStage.tsx',
    ownerMarker: '<LcosWindowChrome',
  },
  SurfaceFeedback: {
    galleryUsage: '<LcosSurfaceFeedback',
    owner: 'ui/LcosSurfaceFeedback.tsx',
    ownerMarker: 'data-lcos-family="surface-feedback"',
  },
  Collection: {
    galleryUsage: '<LcosCollectionSurface',
    owner: 'surfaces/context/ContextAtlasStage.tsx',
    ownerMarker: '<LcosCollectionSurface',
  },
  TaskCard: {
    galleryUsage: '<LcosTaskCard',
    owner: 'surfaces/workflow/WorkflowCardPool.tsx',
    ownerMarker: '<LcosTaskCard',
  },
  Portal: {
    galleryUsage: '<LcosPortalPreview',
    owner: 'professional/PortalPreviewBody.tsx',
    ownerMarker: '<LcosPortalPreview',
  },
};

describe('R1 共享族接线', () => {
  const gallerySource = read(GALLERY);

  for (const [family, { galleryUsage, owner, ownerMarker }] of Object.entries(FAMILIES)) {
    it(`${family}：gallery 与生产各有一个真实 caller`, () => {
      expect(gallerySource).toContain(galleryUsage);
      const ownerPath = join(LCOS_ROOT, ...owner.split('/'));
      expect(existsSync(ownerPath), `找不到生产 caller ${owner}`).toBe(true);
      expect(read(ownerPath)).toContain(ownerMarker);
    });
  }

  it('族根一律带 data-lcos-family（e2e 契约）', () => {
    const familiesSource = read(join(LCOS_ROOT, 'ui', 'families', 'lcos-families.css'));
    for (const family of [
      'navigator-island',
      'railway',
      'window-chrome',
      'surface-feedback',
      'collection-surface',
      'task-card',
      'portal-preview',
      'project-shell',
    ]) {
      expect(familiesSource).toContain(`[data-lcos-family='${family}']`);
    }
  });

  it('族样式不含颜色字面量（颜色只能来自 token）', () => {
    const css = read(join(LCOS_ROOT, 'ui', 'families', 'lcos-families.css'));
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(literals).toEqual([]);
  });

  it('每个生产 caller 都不在 dev 目录里（gallery 不算生产）', () => {
    for (const { owner } of Object.values(FAMILIES)) {
      expect(owner.startsWith('dev/')).toBe(false);
    }
  });
});
