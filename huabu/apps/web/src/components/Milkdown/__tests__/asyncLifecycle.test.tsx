// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
// @vitest-environment happy-dom

import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MilkdownEditor } from '../MilkdownEditor';
import { MilkdownPreview } from '../MilkdownPreview';
import type { MilkdownFactoryOptions, MilkdownInstance } from '../createMilkdown';

const factory = vi.hoisted(() => ({ create: vi.fn(), normalize: (text: string) => text }));
vi.mock('../createMilkdown', () => ({ createMilkdown: factory.create }));
vi.mock('@/api/artifact', () => ({ resolveArtifactUrl: (s: string) => s, uploadImage: vi.fn(), cloneArtifactToCanvas: vi.fn() }));
vi.mock('@/components/Common/Toast', () => ({ toast: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let root: Root | undefined;
let host: HTMLDivElement;
const jobs: { resolve: () => TestInstance; reject: (reason: Error) => void }[] = [];
type TestInstance = MilkdownInstance & { element: HTMLElement; listeners: Set<(value: string) => void> };
async function render(node: ReactNode) {
  if (!root) {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    factory.create.mockImplementation((options: MilkdownFactoryOptions) => new Promise<MilkdownInstance>((resolve, reject) => {
      jobs.push({ reject, resolve: () => {
        let markdown = factory.normalize(options.initialMarkdown);
        const element = document.createElement('div'); element.className = 'ProseMirror'; element.textContent = markdown;
        options.root.append(element);
        const listeners = new Set<(value: string) => void>();
        const value = {
          element, listeners,
          getMarkdown: () => markdown,
          setMarkdown: vi.fn((next: string) => { markdown = factory.normalize(next); element.textContent = markdown; for (const fn of listeners) fn(markdown); }),
          setReadonly: vi.fn((readonly: boolean) => { element.contentEditable = String(!readonly); }),
          setAriaLabel: vi.fn(), setBlockDecorations: vi.fn(),
          onMarkdownUpdated: (fn: (value: string) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
          snapshotBlocks: () => ({ keys: [], getMarkdown: () => null, getDOM: () => null }),
          focus: vi.fn(), destroy: vi.fn(async () => options.root.replaceChildren()),
        } as unknown as TestInstance;
        resolve(value); return value;
      } });
    }));
  }
  await act(async () => root?.render(node));
}
async function resolveJob(index = 0): Promise<TestInstance> {
  let result!: TestInstance;
  await act(async () => { result = jobs[index]!.resolve(); });
  return result;
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; jobs.length = 0; factory.create.mockReset(); factory.normalize = text => text; });

describe('shared Milkdown async lifecycle (factory port, not parser substitution in production)', () => {
  for (const Component of [MilkdownEditor, MilkdownPreview]) {
    it(`${Component.name}: loading A→B→A keeps A`, async () => {
      await render(<Component markdown="A" />); await render(<Component markdown="B" />); await render(<Component markdown="A" />);
      expect((await resolveJob()).getMarkdown()).toBe('A');
    });
    it(`${Component.name}: reports mount failure to the current owner`, async () => {
      const onError = vi.fn(); await render(<Component markdown="原稿" onError={onError} />);
      await act(async () => jobs[0]!.reject(new Error('unavailable')));
      expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'unavailable' }));
    });
  }
  it('catches up readonly and decorations before publishing onReady', async () => {
    const onReady = vi.fn(); await render(<MilkdownEditor markdown="A" editable />);
    await render(<MilkdownEditor markdown="B" editable={false} decorations={{ blocks: [] }} onReady={onReady} />);
    const instance = await resolveJob();
    expect(instance.getMarkdown()).toBe('B'); expect(instance.setReadonly).toHaveBeenLastCalledWith(true);
    expect(instance.setBlockDecorations).toHaveBeenLastCalledWith([]); expect(onReady).toHaveBeenCalledWith(instance);
  });
  it('onReady observes caught-up content, and external catch-up does not echo onChange', async () => {
    const snapshots: string[] = []; const onChange = vi.fn();
    const onReady = (i: MilkdownInstance | null) => { if (i) snapshots.push(i.getMarkdown()); };
    await render(<MilkdownEditor markdown="old" onReady={onReady} onChange={onChange} />);
    await render(<MilkdownEditor markdown="new" onReady={onReady} onChange={onChange} />); await resolveJob();
    expect(snapshots).toEqual(['new']); expect(onChange).not.toHaveBeenCalled();
  });
  it('StrictMode cancelled async initialization cannot clear the live editor DOM', async () => {
    await render(<StrictMode><MilkdownEditor markdown="live" /></StrictMode>);
    expect(jobs).toHaveLength(2);
    const live = await resolveJob(1); const old = await resolveJob(0);
    expect(host.querySelectorAll('.ProseMirror')).toHaveLength(1); expect(host.contains(live.element)).toBe(true);
    expect(old.destroy).toHaveBeenCalledTimes(1);
  });
  it('a drag-mode replacement isolates the obsolete preview mount', async () => {
    await render(<MilkdownPreview markdown="body" enableBlockDrag={false} />);
    await render(<MilkdownPreview markdown="body" enableBlockDrag />);
    const live = await resolveJob(1); await resolveJob(0);
    expect(host.querySelectorAll('.ProseMirror')).toHaveLength(1); expect(host.contains(live.element)).toBe(true);
  });
  it('external serializer normalization never emits a user edit or dirties the owner', async () => {
    factory.normalize = text => text.replace(/\|([A-Z])\|/g, '| $1 |');
    const onChange = vi.fn(); await render(<MilkdownEditor markdown="|A|" onChange={onChange} />);
    const instance = await resolveJob(); await render(<MilkdownEditor markdown="|B|" onChange={onChange} />);
    expect(instance.getMarkdown()).toBe('| B |'); expect(onChange).not.toHaveBeenCalled();
  });
  it('identical controlled echo preserves the instance without resetting the document', async () => {
    const change = vi.fn(); await render(<MilkdownEditor markdown="A" onChange={change} />); const instance = await resolveJob();
    await act(async () => instance.setMarkdown('B'));
    const count = vi.mocked(instance.setMarkdown).mock.calls.length;
    await render(<MilkdownEditor markdown="B" onChange={change} />);
    expect(instance.setMarkdown).toHaveBeenCalledTimes(count); expect(factory.create).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith('B');
  });
  it('detaches subscriptions and ignores late creation failure on close', async () => {
    await render(<MilkdownEditor markdown="A" />); const instance = await resolveJob();
    await act(async () => root?.render(null)); expect(instance.listeners.size).toBe(0);
    const onError = vi.fn(); await render(<MilkdownPreview markdown="B" onError={onError} />);
    await act(async () => root?.render(null)); await act(async () => jobs[1]!.reject(new Error('late')));
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports rendered content after synchronization without replacing the live preview', async () => {
    const onRendered = vi.fn(); await render(<MilkdownPreview markdown="A" onRendered={onRendered} />);
    await resolveJob(); expect(onRendered).toHaveBeenLastCalledWith('A');
    await render(<MilkdownPreview markdown="B" onRendered={onRendered} />);
    expect(onRendered).toHaveBeenLastCalledWith('B'); expect(factory.create).toHaveBeenCalledTimes(1);
  });
});
