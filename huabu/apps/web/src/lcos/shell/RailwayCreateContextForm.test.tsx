import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RailwayCreateContextForm } from './RailwayCreateContextForm';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('RailwayCreateContextForm', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  async function cleanup(): Promise<void> {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  }

  afterEach(cleanup);

  async function render(overrides: Partial<React.ComponentProps<typeof RailwayCreateContextForm>> = {}) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const props: React.ComponentProps<typeof RailwayCreateContextForm> = {
      name: 'Context',
      onNameChange: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      busy: false,
      retry: false,
      disabled: false,
      ...overrides,
    };
    await act(async () => root?.render(<RailwayCreateContextForm {...props} />));
    return { element: host.querySelector('form'), props };
  }

  it('autofocuses the name field and submits once through native Enter form submission', async () => {
    const { element, props } = await render();
    const input = element?.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(element?.querySelector('h3')?.textContent).toBe('新建上下文现场');

    await act(async () => input?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    })));
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => element?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(props.onSubmit).toHaveBeenCalledOnce();
    const cancel = element?.querySelector<HTMLButtonElement>('button[type="button"]');
    expect(cancel?.textContent).toContain('取消');
    expect(cancel?.type).toBe('button');
    await act(async () => cancel?.click());
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it('uses the existing retry and busy labels and blocks disabled or empty submits', async () => {
    const busy = await render({ busy: true, retry: true, name: 'Context', message: '继续使用原现场身份' });
    expect(busy.element?.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain('正在建立…');
    expect(busy.element?.querySelector('[role="status"]')?.textContent).toBe('继续使用原现场身份');
    expect(busy.element?.querySelector<HTMLInputElement>('input')?.readOnly).toBe(true);
    await act(async () => busy.element?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(busy.props.onSubmit).not.toHaveBeenCalled();

    await cleanup();

    const retry = await render({ retry: true, name: 'Context' });
    expect(retry.element?.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain('继续建立上下文现场');
    expect(retry.element?.querySelector<HTMLInputElement>('input')?.readOnly).toBe(true);
    expect(document.activeElement).toBe(retry.element?.querySelector('input'));
    await act(async () => retry.element?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(retry.props.onSubmit).toHaveBeenCalledOnce();

    await cleanup();

    const disabled = await render({ disabled: true, name: 'Context' });
    expect(disabled.element?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => disabled.element?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(disabled.props.onSubmit).not.toHaveBeenCalled();

    await cleanup();

    const empty = await render({ name: '   ' });
    expect(empty.element?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => empty.element?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(empty.props.onSubmit).not.toHaveBeenCalled();
  });
});
