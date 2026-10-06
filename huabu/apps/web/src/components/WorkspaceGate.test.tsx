import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceGate } from './WorkspaceGate';

import type { RouteObject } from 'react-router-dom';

vi.mock('../pages/WorkspaceLoadingScreen', async () => {
  const { createElement } = await import('react');
  return { WorkspaceLoadingScreen: () => createElement('div', { 'data-testid': 'workspace-loading' }) };
});
vi.mock('../lcos/ui/FigmaShellGlyph', () => ({ FigmaShellGlyph: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let containers: HTMLElement[] = [];

function mount(routes: RouteObject[], initialEntry: string): { readonly container: HTMLElement; readonly router: ReturnType<typeof createMemoryRouter> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  act(() => root.render(<RouterProvider router={router} />));
  return { container, router };
}

function Path(): React.JSX.Element {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function gatedRoute(props: Omit<React.ComponentProps<typeof WorkspaceGate>, 'children'>, child: React.ReactNode): React.JSX.Element {
  return <><Path /><WorkspaceGate {...props}>{child}</WorkspaceGate></>;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
  document.body.replaceChildren();
});

describe('WorkspaceGate', () => {
  it('keeps the current route during a service error and offers retry', () => {
    const retry = vi.fn();
    const { container, router } = mount([
      { path: '/projects/:projectId', element: gatedRoute({ initialising: false, isSyncing: false,
        isReady: false, error: 'connection refused', onRetry: retry }, <div data-testid="project-outlet" />) },
      { path: '/setup', element: <div data-testid="setup-page" /> },
    ], '/projects/current');

    expect(router.state.location.pathname).toBe('/projects/current');
    expect(container.querySelector('[data-lcos-feedback-message]')?.textContent)
      .toBe('工作区服务暂时连接不上，重试后继续当前项目');
    expect(container.querySelector('[data-testid="project-outlet"]')).toBeNull();
    expect(container.querySelector('[data-testid="setup-page"]')).toBeNull();
    act(() => (container.querySelector('[data-lcos-feedback-action]') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/projects/current');
  });

  it('renders the original route outlet after retry resolves the workspace', () => {
    function RetryingRoute(): React.JSX.Element {
      const [ready, setReady] = useState(false);
      const [error, setError] = useState<string | null>('offline');
      return gatedRoute({ initialising: false, isSyncing: false, isReady: ready, error,
        onRetry: () => { setError(null); setReady(true); } }, <div data-testid="project-outlet">Original project</div>);
    }
    const { container, router } = mount([
      { path: '/projects/:projectId', element: <RetryingRoute /> },
      { path: '/setup', element: <div data-testid="setup-page" /> },
    ], '/projects/current');

    act(() => (container.querySelector('[data-lcos-feedback-action]') as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="project-outlet"]')?.textContent).toBe('Original project');
    expect(router.state.location.pathname).toBe('/projects/current');
    expect(container.querySelector('[data-testid="setup-page"]')).toBeNull();
  });

  it('sends a confirmed unconfigured guarded route to setup', () => {
    const { container, router } = mount([
      { path: '/projects/:projectId', element: gatedRoute({ initialising: false, isSyncing: false,
        isReady: false, error: null, onRetry: vi.fn() }, <div data-testid="project-outlet" />) },
      { path: '/setup', element: <><Path /><div data-testid="setup-page" /></> },
    ], '/projects/current');

    expect(router.state.location.pathname).toBe('/setup');
    expect(container.querySelector('[data-testid="setup-page"]')).not.toBeNull();
  });

  it('shows loading before the service error while a retry is syncing', () => {
    const { container, router } = mount([
      { path: '/projects/:projectId', element: gatedRoute({ initialising: false, isSyncing: true,
        isReady: false, error: 'offline', onRetry: vi.fn() }, <div data-testid="project-outlet" />) },
      { path: '/setup', element: <div data-testid="setup-page" /> },
    ], '/projects/current');

    expect(router.state.location.pathname).toBe('/projects/current');
    expect(container.querySelector('[data-lcos-feedback-action]')).toBeNull();
    expect(container.querySelector('[data-testid="setup-page"]')).toBeNull();
  });

  it('shows the same service recovery instead of forcing a path choice on setup when offline', () => {
    const retry = vi.fn();
    const { container, router } = mount([
      { path: '/setup', element: gatedRoute({ initialising: false, isSyncing: false, isReady: false,
        error: 'connection refused', onRetry: retry, mode: 'setup' }, <div data-testid="path-setup-form" />) },
    ], '/setup');

    expect(router.state.location.pathname).toBe('/setup');
    expect(container.querySelector('[data-lcos-feedback-message]')?.textContent)
      .toBe('工作区服务暂时连接不上，重试后继续当前项目');
    expect(container.querySelector('[data-testid="path-setup-form"]')).toBeNull();
    act(() => (container.querySelector('[data-lcos-feedback-action]') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
