// 回归测试：StrictMode 下 effect 会 mount→cleanup→mount。
//
// 早期实现用「已解析过就 early-return」的 ref 守卫：第一次 effect 发起异步查询后立刻被
// cleanup 取消，第二次 effect 因 `resolvedFor.current === canvasId` 直接 return —— 结果
// **永久停在 `resolving`**，`/canvas/:canvasId` 深链永远进不了 LCOS Shell。
// 该缺陷由 Wave 1 浏览器验收（`scripts/e2e/wave1-acceptance.mjs`）实测暴露。
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type { LcosCanvasBinding } from './useLcosCanvasBinding';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getWorkspaces: vi.fn(),
}));

vi.mock('./lcosCoreClient', () => ({
  createLcosCoreSession: () => ({
    projects: {
      listProjects: mocks.listProjects,
      getWorkspaces: mocks.getWorkspaces,
    },
  }),
}));

const { useLcosCanvasBinding } = await import('./useLcosCanvasBinding');

async function renderUnderStrictMode(canvasId: string): Promise<LcosCanvasBinding[]> {
  const seen: LcosCanvasBinding[] = [];
  const Probe = (): null => {
    seen.push(useLcosCanvasBinding(canvasId));
    return null;
  };
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => root.unmount());
  return seen;
}

it('StrictMode 下解析出 canonical 归属，不会停在 resolving', async () => {
  mocks.listProjects.mockResolvedValue([{ id: 'p1' }]);
  mocks.getWorkspaces.mockResolvedValue([
    { id: 'w1', canvasId: 'c1', preferredSurface: 'main' },
  ]);

  const seen = await renderUnderStrictMode('c1');

  expect(seen.at(-1)).toEqual({
    kind: 'resolved',
    projectId: 'p1',
    workspaceId: 'w1',
    surface: 'main',
  });
});

it('画布不属于任何项目工作现场时返回 unbound（不伪造项目）', async () => {
  mocks.listProjects.mockResolvedValue([{ id: 'p1' }]);
  mocks.getWorkspaces.mockResolvedValue([
    { id: 'w1', canvasId: 'other', preferredSurface: 'main' },
  ]);

  const seen = await renderUnderStrictMode('orphan');

  expect(seen.at(-1)).toEqual({ kind: 'unbound' });
});