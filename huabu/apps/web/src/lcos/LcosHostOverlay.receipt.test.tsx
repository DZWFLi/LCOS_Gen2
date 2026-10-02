import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LcosHostOverlay } from './LcosHostOverlay';
import { useLcosDropStore } from './lcosDropState';
import { resolveDropIntent } from './drop/dropIntentResolver';
import { useLcosReferenceStore } from './lcosReferenceState';
import { useLcosShellStore } from './shell/lcosShellStore';
import type { AssemblyApplyItemResultV1, AssemblyApplyRequestV1, AssemblySourceRefV1 } from '@local-creative-os/contracts';
import type { DropAssemblyApplyIntent, DropTargetRegistration } from './drop/dropTypes';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const refs: readonly AssemblySourceRefV1[] = [{ kind: 'artifactView', id: 'view-a' }, { kind: 'note', id: 'b' }, { kind: 'resource', id: 'c' }];
const intent: DropAssemblyApplyIntent = { kind: 'assembly-apply', targetId: 'canvas:one', targetRef: { kind: 'workspace', id: 'original-child' }, sourceRefs: refs, placementPoint: { x: 17, y: 41 } };
const item = (index: number, status: AssemblyApplyItemResultV1['status'], channel: AssemblyApplyItemResultV1['channel']): AssemblyApplyItemResultV1 => ({ sourceRef: refs[index]!, status, channel, message: status === 'failed' ? '源暂不可用' : undefined });
async function mountWith(results: AssemblyApplyItemResultV1[][], dropIntent = intent, prepare = () => {}): Promise<AssemblyApplyRequestV1[]> {
  const requests: AssemblyApplyRequestV1[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toContain('/projects/project-one/assembly/apply');
    expect(options.method).toBe('POST');
    requests.push(JSON.parse(String(options.body)) as AssemblyApplyRequestV1);
    return new Response(JSON.stringify({ ok: true, value: { schemaVersion: 1, projectId: 'project-one', allApplied: true, results: results[requests.length - 1] } }), { status: 200 });
  }));
  useLcosShellStore.getState().clear();
  useLcosShellStore.getState().setProject('project-one');
  prepare();
  useLcosDropStore.setState({ state: { status: 'preview', payload: { kind: 'assembly', itemId: 'view-a', sourceRef: refs[0]! }, destination: { targetId: dropIntent.targetId, previewPoint: { x: 200, y: 200 } }, carryAnchor: 'left' }, resolution: { status: 'ready', intent: dropIntent } });
  useLcosDropStore.getState().commitAt('first-attempt');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root!.render(<LcosHostOverlay />); });
  return requests;
}
afterEach(() => {
  if (root) act(() => root!.unmount()); root = undefined; container?.remove(); container = undefined;
  useLcosDropStore.getState().reset(); useLcosReferenceStore.getState().reset(); useLcosShellStore.getState().clear(); vi.unstubAllGlobals();
});
describe('production Host → real CoreAssemblyClient HTTP contract → Drop feedback', () => {
  it('retains partial rows and retries only the failed exact source at original target/placement', async () => {
    const requests = await mountWith([
      [item(0, 'applied', 'presentation-membership'), item(1, 'failed', 'error'), item(2, 'skipped', 'unsupported')],
      [item(1, 'applied', 'workspace-membership')],
    ]);
    expect(document.body.querySelector('[data-lcos-drop-receipt]')?.getAttribute('data-status')).toBe('partial');
    expect(document.body.textContent).toContain('部分完成'); expect(document.body.textContent).toContain('源暂不可用');
    expect(document.body.querySelectorAll('li')).toHaveLength(3);
    const retry = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('只重试失败项'))!;
    expect(retry).toBeTruthy();
    await act(async () => { retry.click(); retry.click(); });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ sourceRefs: [refs[1]], targetRef: intent.targetRef, placementBySource: { b: { x: 17, y: 41 } } });
    expect(requests[1]!.placementBySource).not.toHaveProperty('view-a');
    expect(document.body.querySelectorAll('li')).toHaveLength(3);
    expect(document.body.textContent).toContain('2 项已加入'); expect(document.body.textContent).toContain('不支持');
    expect(document.body.textContent).not.toContain('只重试失败项');
  });
  it('all failed never closes as success and repeated transaction callbacks do not overwrite new gestures', async () => {
    const requests = await mountWith([refs.map((_, index) => item(index, 'failed', 'error'))]);
    expect(requests).toHaveLength(1);
    expect(document.body.querySelector('[data-lcos-drop-receipt]')?.getAttribute('data-status')).toBe('failed');
    expect(document.body.textContent).not.toContain('投放完成');
    const oldReceipt = useLcosDropStore.getState().feedback!.receipt;
    act(() => { useLcosDropStore.getState().begin({ kind: 'object', entityType: 'note', entityId: 'new' }); useLcosDropStore.getState().settle(oldReceipt); });
    expect(useLcosDropStore.getState().state.status).toBe('tracking'); expect(useLcosDropStore.getState().feedback).toBeNull();
  });
  it('does not carry a failed old-project request into the next project', async () => {
    const requests = await mountWith([refs.map((_, index) => item(index, 'failed', 'error'))]);
    await act(async () => { useLcosShellStore.getState().setProject('project-two'); });
    expect(requests).toHaveLength(1);
    expect(useLcosDropStore.getState().state.status).toBe('idle');
    expect(document.body.querySelector('[data-lcos-drop-receipt]')).toBeNull();
  });
  it('all already-member offers no replay and says there was no new apply', async () => {
    await mountWith([refs.map((_, index) => item(index, 'skipped', 'already-member'))]);
    expect(document.body.textContent).toContain('已在目标中'); expect(document.body.textContent).not.toContain('只重试失败项');
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });
});


describe('T3 durable Glyth body vs temporary Composer references', () => {
  it.each([
    ['applied', 'relation', 'success', '已保存到会话上下文'],
    ['skipped', 'already-member', 'success', '已在会话上下文中'],
    ['failed', 'error', 'failed', '投放未完成'],
  ] as const)('uses the real Assembly HTTP caller for %s and preserves the existing draft', async (status, channel, expected, message) => {
    const resolved = resolveDropIntent({ kind: 'object', entityType: 'artifact', entityId: 'artifact-a', artifactViewId: 'view-a' }, {
      targetId: 'glyth:conversation-a', kind: 'collaboration-reference', label: '创作会话',
      rect: { left: 10, top: 20, width: 80, height: 80 }, priority: 20, enabled: true,
      semantic: { kind: 'collaboration-reference', conversationId: 'conversation-a' },
    });
    if (resolved.status !== 'ready' || resolved.intent.kind !== 'assembly-apply') throw new Error('Glyth body did not resolve to canonical owner');
    const requests = await mountWith([[item(0, status, channel)]], resolved.intent, () => {
      useLcosShellStore.getState().setComposerPrompt('另一处尚未发送的草稿');
      useLcosReferenceStore.getState().addEntityToDraft({ entityType: 'note', entityId: 'existing-draft-ref' });
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ schemaVersion: 1, projectId: 'project-one', sourceRefs: [{ kind: 'artifactView', id: 'view-a' }], targetRef: { kind: 'conversation', id: 'conversation-a' } });
    expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toEqual([{ entityType: 'note', entityId: 'existing-draft-ref' }]);
    expect(useLcosShellStore.getState().composerPrompt).toBe('另一处尚未发送的草稿');
    expect(useLcosShellStore.getState().composerOpen).toBe(false);
    expect(useLcosDropStore.getState().feedback?.receipt.status).toBe(expected);
    expect(document.body.textContent).toContain(message);
  });

  it('routes a resolved Portal destination through Assembly workspace membership and names the Portal receipt', async () => {
    const portalTarget: DropTargetRegistration = {
      targetId: 'portal:portal-a', kind: 'portal-receive', label: '入口 · 资料现场',
      rect: { left: 10, top: 20, width: 80, height: 80 }, priority: 25, enabled: true,
      semantic: { kind: 'portal-receive', targetRef: { kind: 'workspace', id: 'workspace-a' } },
    };
    const resolved = resolveDropIntent({ kind: 'assembly', itemId: 'view-a', sourceRef: refs[0]! }, portalTarget);
    if (resolved.status !== 'ready' || resolved.intent.kind !== 'assembly-apply') throw new Error('Portal did not resolve to Assembly apply');
    const requests = await mountWith([[item(0, 'applied', 'workspace-membership')]], resolved.intent, () => {
      useLcosDropStore.getState().registerTarget(portalTarget);
    });
    expect(requests).toEqual([{ schemaVersion: 1, projectId: 'project-one', sourceRefs: [refs[0]], targetRef: { kind: 'workspace', id: 'workspace-a' } }]);
    expect(document.body.textContent).toContain('入口 · 资料现场');
    expect(document.body.textContent).toContain('投放完成');
  });
});
