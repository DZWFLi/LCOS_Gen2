import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReaderContentView } from './ReaderContentView';

let host: HTMLDivElement;
let root: Root;
let scrollable = true;

beforeEach(() => {
  scrollable = true;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('[data-lcos-reader-content="text"]') && scrollable ? 560 : 120;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const textContent = (renderedText: ReactNode) => ({
  content: { kind: 'text' as const, value: '来自既有渲染器的正文', viewKey: 'reader-proof' },
  kind: 'markdown',
  fileName: '正文.md',
  renderedText,
});

describe('Reader Rare UI scroll progress', () => {
  it('mounts only for rendered headings in a scrollable Reader viewport', async () => {
    await act(async () => root.render(<ReaderContentView {...textContent(<><h1>开篇</h1><p>正文</p></>)} />));
    expect(host.querySelector('[data-lcos-reader-scroll-progress]')).not.toBeNull();

    await act(async () => root.render(<ReaderContentView {...textContent(<p>没有章节标题</p>)} />));
    expect(host.querySelector('[data-lcos-reader-scroll-progress]')).toBeNull();

    scrollable = false;
    await act(async () => root.render(<ReaderContentView {...textContent(<h1>短正文</h1>)} />));
    expect(host.querySelector('[data-lcos-reader-scroll-progress]')).toBeNull();
  });

  it('scopes repeated source heading ids to each Reader and scrolls the local heading', async () => {
    await act(async () => root.render(<>
      <ReaderContentView {...textContent(<><h2 id="shared-heading">共同章节</h2><a href="#shared-heading">跳到章节</a></>)} />
      <ReaderContentView {...textContent(<><h2 id="shared-heading">共同章节</h2><a href="#shared-heading">跳到章节</a></>)} />
    </>));

    const readers = [...host.querySelectorAll<HTMLElement>('[data-lcos-reader-content="text"]')];
    const firstReader = readers[0];
    const secondReader = readers[1];
    if (firstReader === undefined || secondReader === undefined) throw new Error('Expected two rendered Reader instances');
    const firstHeading = firstReader.querySelector<HTMLHeadingElement>('h2');
    const secondHeading = secondReader.querySelector<HTMLHeadingElement>('h2');
    if (firstHeading === null || secondHeading === null) throw new Error('Expected a rendered heading in each Reader');
    expect(firstHeading.id).not.toBe(secondHeading.id);
    expect(firstHeading.dataset.lcosReaderSourceId).toBe('shared-heading');
    expect(firstReader.querySelector('a')?.getAttribute('href')).toBe(`#${firstHeading.id}`);
    expect(secondReader.querySelector('a')?.getAttribute('href')).toBe(`#${secondHeading.id}`);

    const localScroll = vi.fn();
    const otherScroll = vi.fn();
    Object.defineProperty(firstHeading, 'scrollIntoView', { configurable: true, value: localScroll });
    Object.defineProperty(secondHeading, 'scrollIntoView', { configurable: true, value: otherScroll });
    const progress = host.querySelectorAll<HTMLElement>('[data-lcos-reader-scroll-progress]')[1];
    if (progress === undefined) throw new Error('Expected a progress control for the second Reader');
    const trigger = progress.querySelector<HTMLButtonElement>('[aria-label="显示章节目录"]');
    if (trigger === null) throw new Error('Expected the second Reader progress pill');
    await act(async () => trigger.click());
    const sectionButton = progress.querySelector<HTMLButtonElement>('ul button');
    if (sectionButton === null) throw new Error('Expected the rendered section entry');
    await act(async () => sectionButton.click());
    expect(localScroll).not.toHaveBeenCalled();
    expect(otherScroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('lets its Escape owner close the section list and restore focus to the pill', async () => {
    await act(async () => root.render(<ReaderContentView {...textContent(<h1>开篇</h1>)} />));
    const trigger = host.querySelector<HTMLButtonElement>('[data-lcos-reader-scroll-progress] [aria-label="显示章节目录"]');
    if (trigger === null) throw new Error('Expected the Reader progress pill');
    await act(async () => trigger.click());
    expect(host.querySelector('[data-lcos-reader-scroll-progress] ul')).not.toBeNull();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => document.dispatchEvent(escape));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 320)));
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector('[data-lcos-reader-scroll-progress] ul')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
