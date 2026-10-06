// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { CollectionMemberPreview } from './CollectionMemberPreview';

import type { CollectionMemberPreview as Member, CoreArtifactClient } from '@local-creative-os/web-gen2';


(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
const getFileRecordContent = vi.fn<CoreArtifactClient['getFileRecordContent']>();
const client: Pick<CoreArtifactClient, 'getFileRecordContent'> = { getFileRecordContent };
const artifact = (overrides: Partial<Member> = {}): Member => ({
  type: 'artifact', id: 'artifact-positioning', label: '项目定位', kind: 'text', availability: 'available',
  revisionId: 'revision-positioning', archived: false, ...overrides,
} as unknown as Member);
const render = (member: Member, onRead?: () => void, parentClick?: () => void): HTMLDivElement => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const preview = <CollectionMemberPreview projectId="project" member={member} client={client} enabled={false}
    presentation="gen1-sheet" sheetIndex={0} onRead={onRead} />;
  const rendered = parentClick ? (
    // This wrapper models the React card handler that the read button must not trigger.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div onClick={parentClick}>{preview}</div>
  ) : preview;
  act(() => root?.render(rendered));
  return host;
};
afterEach(() => { if (root) act(() => root?.unmount()); root = undefined; host?.remove(); host = undefined; vi.mocked(getFileRecordContent).mockReset(); });

it('offers a named native read button on the existing available Artifact member preview without activating its parent card', () => {
  const onRead = vi.fn(); const parentClick = vi.fn();
  const view = render(artifact(), onRead, parentClick);
  const button = view.querySelector<HTMLButtonElement>('[data-lcos-collection-member-read="artifact:artifact-positioning"]');
  expect(button?.getAttribute('aria-label')).toBe('阅读 项目定位');
  expect(button?.title).toBe('在阅读器打开 项目定位');
  expect(button?.classList.contains('pointer-events-auto')).toBe(true);
  expect(view.querySelector('.lcos-collection-stack-sheet')?.hasAttribute('style')).toBe(false);
  act(() => button?.click());
  expect(onRead).toHaveBeenCalledExactlyOnceWith();
  expect(parentClick).not.toHaveBeenCalled();
  expect(client.getFileRecordContent).not.toHaveBeenCalled();
});

it.each([
  ['non-artifact', artifact({ type: 'workspace' as Member['type'] })],
  ['unavailable', artifact({ availability: 'stale' })],
] as const)('does not advertise Reader for a %s member', (_name, member) => {
  const view = render(member, vi.fn());
  expect(view.querySelector('[data-lcos-collection-member-read]')).toBeNull();
});
