// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover';

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe('Popover', () => {
  it('marks its portal root as floating chrome', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <Popover position={{ x: 20, y: 20 }}>
          <span>Content</span>
        </Popover>,
      );
    });

    const content = Array.from(document.body.querySelectorAll('span')).find(
      (element) => element.textContent === 'Content',
    );
    expect(content?.parentElement?.hasAttribute('data-floating-chrome')).toBe(
      true,
    );
  });
});

// A growing menu previously detached its inline ref on every render, feeding
// setContentElement back into layout. Retain the same measured DOM instance.
it('retains the content ref when the parent changes its menu', () => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); const capture = vi.fn();
  act(() => root?.render(<Popover position={{x:20,y:20}} contentRef={capture}><span>One</span></Popover>));
  const element = capture.mock.calls.at(-1)?.[0]; capture.mockClear();
  act(() => root?.render(<Popover position={{x:20,y:20}} contentRef={capture}><span>Two</span><span>Three</span></Popover>));
  expect(capture).not.toHaveBeenCalled(); expect(element?.textContent).toBe('TwoThree');
});
