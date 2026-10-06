import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/Common/Popover', () => ({
  Popover: ({ children, className }: { children: ReactNode; className?: string }) =>
    <div data-test-popover className={className}>{children}</div>,
}));

import { LcosProjectSystemMenu } from './LcosProjectSystemMenu';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('LcosProjectSystemMenu project identity', () => {
  it('shows the project and current worksite while keeping the menu link on the project', async () => {
    await act(async () => root.render(
      <MemoryRouter>
        <LcosProjectSystemMenu name="品牌项目" worksiteName="春季主视觉" assemblyTitle="收件与来源" />
      </MemoryRouter>,
    ));

    const identity = host.querySelector<HTMLButtonElement>('[data-lcos-project-identity]')!;
    expect(identity.textContent).toContain('品牌项目 / 春季主视觉');
    expect(identity.getAttribute('aria-label')).toBe('品牌项目 / 春季主视觉 · 项目菜单');
    expect(identity.title).toBe('品牌项目 / 春季主视觉');

    await act(async () => identity.click());
    const projectLink = host.querySelector<HTMLAnchorElement>('.lcos-project-system-menu header a')!;
    expect(projectLink.textContent).toBe('品牌项目');
    expect(projectLink.getAttribute('href')).toBe('/projects');
  });

  it('does not invent or expose a worksite identifier when its name is unresolved', async () => {
    await act(async () => root.render(
      <MemoryRouter>
        <LcosProjectSystemMenu name="品牌项目" assemblyTitle="收件与来源" />
      </MemoryRouter>,
    ));

    const identity = host.querySelector<HTMLButtonElement>('[data-lcos-project-identity]')!;
    expect(identity.textContent).toBe('品牌项目');
    expect(identity.getAttribute('aria-label')).toBe('品牌项目 · 项目菜单');
    expect(identity.title).toBe('品牌项目');
  });
});
