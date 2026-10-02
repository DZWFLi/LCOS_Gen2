import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssemblyMasonryView } from './AssemblyMasonryView';
import { AssemblyMaterialView } from './AssemblyMaterialView';
import { AssemblySourceTabsView } from './AssemblySourceTabsView';
import { ConversationEventView } from './ConversationEventView';
import { ConversationIdentityView } from './ConversationIdentityView';
import { ReaderContentView } from './ReaderContentView';
import { ReaderGroupView } from './ReaderGroupView';

import type { ReactNode } from 'react';

const mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement }[] = [];
async function mount(node: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  await act(async () => root.render(node));
  return host;
}

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

describe('Reader production presentation', () => {
  it('renders Markdown through the shared Milkdown schema rather than a line-prefix parser', async () => {
    const content = { kind: 'text' as const, value: '# 标题\n\n**粗体** 和 [链接](https://example.com)\n\n| A | B |\n| --- | --- |\n| 一 | 二 |\n\n```js\nconst x = 1;\n```', viewKey: 'artifact@old-revision' };
    const ready = vi.fn();
    const host = await mount(<ReaderContentView content={content} kind="markdown" fileName="资料" onContentReady={ready} />);
    await vi.waitFor(() => expect(host.querySelector('.ProseMirror strong')?.textContent).toBe('粗体'));
    expect(host.querySelector('.ProseMirror h1')?.textContent).toBe('标题');
    expect(host.querySelector('.ProseMirror a')?.getAttribute('href')).toBe('https://example.com');
    expect(host.querySelector('.ProseMirror table')).not.toBeNull();
    expect(host.querySelector('.ProseMirror pre')?.textContent).toContain('const x = 1;');
    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(ready).toHaveBeenCalledWith(content);
    expect(host.querySelector('[data-donor-text-reader]')).toBeNull();
  });
  it('does not execute untrusted raw markup; a render failure retains the literal source', async () => {
    const value = '第一行\n<script>window.bad = true</script>\n<img src=x onerror="alert(1)">\n<iframe srcdoc="<script>alert(1)</script>"></iframe>\n最后一行';
    const host = await mount(<ReaderContentView content={{ kind: 'text', value }} kind="markdown" fileName="外部文本" />);
    await vi.waitFor(() => expect(host.querySelector('.ProseMirror, [data-lcos-reader-render-error]')).not.toBeNull());
    expect(host.querySelector('script, iframe, [onerror], [onclick]')).toBeNull();
    if (host.querySelector('[data-lcos-reader-render-error]')) {
      const raw = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '查看同一版本原文');
      await act(async () => raw?.click());
      expect(host.querySelector('pre')?.textContent).toBe(value);
    }
    expect((window as Window & { bad?: boolean }).bad).not.toBe(true);
  });
  it('retains the shared parser safe-link click protection', async () => {
    const host = await mount(<ReaderContentView content={{ kind: 'text', value: '[不可执行](javascript:alert%281%29)' }} kind="markdown" fileName="外部链接" />);
    await vi.waitFor(() => expect(host.querySelector('.ProseMirror')).not.toBeNull());
    const unsafe = host.querySelector('a[href^="javascript:"]');
    if (unsafe) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      await act(async () => unsafe.dispatchEvent(click));
      expect(click.defaultPrevented).toBe(true);
    }
    expect(host.querySelector('script, [onclick]')).toBeNull();
  });
  it('preserves plain text bytes including newlines without Markdown interpretation', async () => {
    const value = '# 原始文本\n<script>untrusted()</script>\n最后一行';
    const host = await mount(<ReaderContentView content={{ kind: 'text', value }} kind="text" fileName="原文" />);
    expect(host.querySelector('pre')?.textContent).toBe(value);
    expect(host.querySelector('script, h2')).toBeNull();
  });
  it('keeps the scroll ref on the actual content viewport', async () => {
    const ref = vi.fn();
    const scroll = vi.fn();
    const host = await mount(<ReaderContentView content={{ kind: 'text', value: '正文' }} kind="markdown" fileName="资料" contentRef={ref} onScroll={scroll} />);
    const viewport = host.querySelector('[data-lcos-reader-content="text"]');
    expect(ref).toHaveBeenCalledWith(viewport);
    await act(async () => viewport?.dispatchEvent(new Event('scroll')));
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it('does not treat a genuinely empty text file as missing content', async () => {
    const host = await mount(<ReaderContentView content={{ kind: 'text', value: '' }} kind="markdown" fileName="空文本" />);
    expect(host.querySelector('[data-lcos-reader-content="text"]')).not.toBeNull();
    expect(host.querySelector('[data-lcos-reader-content="unavailable"]')).toBeNull();
  });
  it('uses the exact owner-supplied image URL without staging or mutating it', async () => {
    const host = await mount(<ReaderContentView content={{ kind: 'image', url: 'blob:owner-owned', mimeType: 'image/png' }} kind="image" fileName="原图" />);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:owner-owned');
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('原图');
  });
  it('keeps unsupported content honest and invents no Open/Retry callback', async () => {
    const host = await mount(<ReaderContentView content={null} kind="pdf" fileName="尚不可读" />);
    expect(host.textContent).toContain('暂无可用正文读取通道');
    expect(host.textContent).toContain('PDF 文档');
    expect(host.textContent).not.toContain('pdf 暂无');
    expect(host.querySelector('button')).toBeNull();
  });
  it('consumes supplied feedback instead of manufacturing a success state', async () => {
    const host = await mount(<ReaderContentView content={null} kind="image" fileName="原图" feedback={<span role="alert">读取失败</span>} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('读取失败');
    expect(host.textContent).not.toContain('已就绪');
  });
  it('can reuse a host renderer without reparsing or duplicating its content', async () => {
    const host = await mount(<ReaderContentView content={{ kind: 'text', value: '# 原文' }} kind="markdown" fileName="资料" renderedText={<h1>原文</h1>} />);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('pre')).toBeNull();
  });
});

describe('Controlled reading groups', () => {
  const groups = [{ id: 'a', label: 'A', content: <p>甲</p> }, { id: 'b', label: 'B', content: <p>乙</p> }];
  it('shows both supplied panes in split mode without creating window controls', async () => {
    const host = await mount(<ReaderGroupView groups={groups} presentation="split" activeGroupId="a" />);
    expect(host.querySelectorAll('[data-reader-group-id]:not([hidden])')).toHaveLength(2);
    expect(host.querySelector('button')).toBeNull();
  });
  it('only shows the explicitly active pane in single mode while retaining the other DOM', async () => {
    const host = await mount(<ReaderGroupView groups={groups} presentation="single" activeGroupId="b" />);
    expect(host.querySelectorAll('[data-reader-group-id]')).toHaveLength(2);
    expect(host.querySelector('[data-reader-group-id="a"]')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('[data-reader-group-id="b"]')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('Assembly Source Bay presentation', () => {
  it('retains child order without introducing a second masonry layout engine', async () => {
    const host = await mount(<AssemblyMasonryView><div data-item="first" /><div data-item="second" /></AssemblyMasonryView>);
    expect([...host.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item'))).toEqual(['first', 'second']);
  });
  it('does not substitute a fake photograph for unavailable preview bytes', async () => {
    const host = await mount(<AssemblyMaterialView title="材料" familyLabel="图像" fallbackGlyph={<span>图</span>} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('暂无真实预览');
  });
  it('renders only a real supplied excerpt and escapes it', async () => {
    const host = await mount(<AssemblyMaterialView title="文档" familyLabel="文本" fallbackGlyph={null} excerpt="<b>原文</b>" />);
    expect(host.querySelector('.lcos-assembly-preview-excerpt')?.textContent).toBe('<b>原文</b>');
    expect(host.querySelector('b')).toBeNull();
  });
  it('keeps the image out of native image drag so the existing item drag remains the entry', async () => {
    const host = await mount(<AssemblyMaterialView title="原图" familyLabel="图像" fallbackGlyph={null} previewUrl="blob:read-model" />);
    expect(host.querySelector('img')?.getAttribute('draggable')).toBe('false');
  });
  it('dispatches the existing key without changing selected state by itself', async () => {
    const select = vi.fn();
    const host = await mount(<AssemblySourceTabsView items={[{ key: 'project', label: '项目' }, { key: 'capture', label: '暂存' }]} value="project" onSelect={select} />);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-source-tab="capture"]')?.click());
    expect(select).toHaveBeenCalledWith('capture');
    expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe('项目');
    expect(host.querySelector('[role="tab"]')).toBeNull();
  });
  it('does not dispatch disabled actions', async () => {
    const select = vi.fn();
    const host = await mount(<AssemblySourceTabsView items={[{ key: 'skills', label: '技能', disabled: true }]} value="skills" onSelect={select} />);
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(select).not.toHaveBeenCalled();
  });
});

describe('Conversation presentation', () => {
  it('retains long multiline messages instead of truncating them into event badges', async () => {
    const body = '首段\n' + '这是完整的会话正文。'.repeat(80) + '\n末段';
    const host = await mount(<ConversationEventView kind="agent_message" title="回复" body={body} label="协作者" icon={null} presentation="message" />);
    expect(host.querySelector('.lcos-conversation-event-body')?.textContent).toBe(body);
    expect(host.querySelector('.truncate')).toBeNull();
  });
  it('shows an error without inventing a retry or resend operation', async () => {
    const host = await mount(<ConversationEventView kind="error" title="失败" label="执行失败" icon={null} presentation="activity" tone="danger" />);
    expect(host.querySelector('[data-event-tone="danger"]')).not.toBeNull();
    expect(host.querySelector('button')).toBeNull();
  });
  it('preserves current capability notices and supplied callbacks', async () => {
    const action = vi.fn();
    const host = await mount(<ConversationIdentityView title="当前会话" stateLabel="暂时不可用" actions={<button onClick={action}>装配</button>}><p>不支持直接追加消息</p></ConversationIdentityView>);
    expect(host.textContent).toContain('不支持直接追加消息');
    await act(async () => host.querySelector<HTMLButtonElement>('button')?.click());
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-lcos-conversation-user-state]')?.textContent).toBe('暂时不可用');
  });
});
