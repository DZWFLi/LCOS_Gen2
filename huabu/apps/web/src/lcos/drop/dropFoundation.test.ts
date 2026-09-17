import { describe, expect, it, vi } from 'vitest';

import { DropCommitRouter } from './dropCommitRouter';
import { resolveDropIntent } from './dropIntentResolver';
import { DropTargetRegistry } from './dropTargetRegistry';

import type { DropTargetRegistration } from './dropTypes';

const canvasTarget: DropTargetRegistration = {
  targetId: 'canvas:main',
  kind: 'canvas',
  label: 'Main',
  rect: { left: 0, top: 0, width: 800, height: 600 },
  priority: 1,
  enabled: true,
  semantic: { kind: 'canvas', targetRef: { kind: 'main' } },
};

const railwayTarget: DropTargetRegistration = {
  targetId: 'railway:context-a',
  kind: 'railway-receive',
  label: 'Context A',
  rect: { left: 0, top: 0, width: 800, height: 600 },
  priority: 2,
  enabled: true,
  semantic: {
    kind: 'railway-receive',
    targetRef: { kind: 'workspace', id: 'ws-context-a' },
    destinationRef: { kind: 'context', viewId: 'ws-context-a' },
  },
};

describe('R1 target registry', () => {
  it('chooses the highest-priority eligible target without persistence', () => {
    const registry = new DropTargetRegistry();
    registry.register(canvasTarget);
    registry.register(railwayTarget);
    expect(registry.hitTest({ x: 10, y: 10 })?.targetId).toBe(
      'railway:context-a',
    );
    registry.unregister('railway:context-a');
    expect(registry.hitTest({ x: 10, y: 10 })?.targetId).toBe('canvas:main');
  });

  it('does not hit disabled or ineligible targets', () => {
    const registry = new DropTargetRegistry();
    registry.register({
      ...canvasTarget,
      enabled: false,
      ineligibleReason: '现场未就绪',
    });
    expect(registry.hitTest({ x: 10, y: 10 })).toBeUndefined();
  });
});

describe('R1 single drop intent resolver', () => {
  it('resolves object to canvas and railway receive through assembly apply', () => {
    const payload = {
      kind: 'object',
      entityType: 'artifact',
      entityId: 'a-1',
    } as const;
    const canvas = resolveDropIntent(payload, canvasTarget);
    const railway = resolveDropIntent(payload, railwayTarget);
    expect(canvas).toEqual({
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        targetId: 'canvas:main',
        targetRef: { kind: 'main' },
        sourceRefs: [{ kind: 'artifactView', id: 'a-1' }],
      },
    });
    expect(railway).toMatchObject({
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        railwayReceive: true,
        railwayDestinationRef: { kind: 'context', viewId: 'ws-context-a' },
      },
    });
  });

  it('fails closed when an external payload has no real owner', () => {
    const target: DropTargetRegistration = {
      targetId: 'canvas:main',
      kind: 'canvas',
      label: 'Main',
      rect: canvasTarget.rect,
      priority: 1,
      enabled: true,
      semantic: { kind: 'canvas', targetRef: { kind: 'main' } },
    };
    expect(resolveDropIntent({ kind: 'file', name: 'x.png' }, target)).toEqual({
      status: 'ineligible',
      targetId: 'canvas:main',
      reason: '该来源没有可写入 Core 的实体引用',
    });
  });

  it('resolves Composer references without opening a second chooser', () => {
    const target: DropTargetRegistration = {
      ...canvasTarget,
      targetId: 'composer:visible',
      kind: 'composer-reference',
      semantic: { kind: 'composer-reference' },
    };
    expect(
      resolveDropIntent(
        { kind: 'object', entityType: 'note', entityId: 'n-1' },
        target,
      ),
    ).toEqual({
      status: 'ready',
      intent: {
        kind: 'composer-reference',
        targetId: 'composer:visible',
        reference: { entityType: 'note', entityId: 'n-1' },
      },
    });
  });

  it('CollaborationTarget（R1 合流）：Drop 到 Glyth = 作为 Reference 交给该会话（preview=execute）', () => {
    const glyth: DropTargetRegistration = {
      targetId: 'glyth:node-1',
      kind: 'collaboration-reference',
      label: '会话引用 · Glyth',
      rect: canvasTarget.rect,
      priority: 20,
      enabled: true,
      semantic: { kind: 'collaboration-reference', conversationId: 'c-1' },
    };
    const intent = resolveDropIntent(
      { kind: 'object', entityType: 'artifact', entityId: 'a-1' },
      glyth,
    );
    // preview = execute：一次解析出 intent，commit 使用同一对象，无二次选择窗。
    expect(intent).toEqual({
      status: 'ready',
      intent: {
        kind: 'collaboration-reference',
        targetId: 'glyth:node-1',
        conversationId: 'c-1',
        reference: { entityType: 'artifact', entityId: 'a-1' },
      },
    });
    // 文件/文本不是实体引用 → fail-close（不落座、不伪造成功）。
    expect(
      resolveDropIntent({ kind: 'file', name: 'x.png' }, glyth),
    ).toMatchObject({ status: 'ineligible' });
  });
});

describe('R1 commit router', () => {
  it('routes through canonical owners and de-duplicates a transaction', async () => {
    const applyAssembly = vi.fn(async () => ({ changeSetId: 'cs-1' }));
    const router = new DropCommitRouter();
    const intent = {
      kind: 'assembly-apply' as const,
      targetId: 'canvas:main',
      targetRef: { kind: 'main' as const },
      sourceRefs: [{ kind: 'artifactView' as const, id: 'a-1' }],
    };
    const first = await router.commit(intent, 'tx-1', {
      applyAssembly,
      addComposerReference: vi.fn(),
    });
    const second = await router.commit(intent, 'tx-1', {
      applyAssembly,
      addComposerReference: vi.fn(),
    });
    expect(first).toEqual({
      status: 'success',
      transactionId: 'tx-1',
      targetId: 'canvas:main',
      canonicalReceipt: { changeSetId: 'cs-1' },
    });
    expect(second).toBe(first);
    expect(applyAssembly).toHaveBeenCalledTimes(1);
  });

  it('CollaborationTarget commit：owner 存在才成功，缺席 fail-close（禁止 fake drop success）', async () => {
    const router = new DropCommitRouter();
    const addConversationReference = vi.fn();
    const intent = {
      kind: 'collaboration-reference' as const,
      targetId: 'glyth:node-1',
      conversationId: 'c-1',
      reference: { entityType: 'artifact' as const, entityId: 'a-1' },
    };
    const ok = await router.commit(intent, 'tx-collab', {
      applyAssembly: vi.fn(),
      addComposerReference: vi.fn(),
      addConversationReference,
    });
    expect(ok).toMatchObject({ status: 'success', transactionId: 'tx-collab' });
    expect(addConversationReference).toHaveBeenCalledWith(intent);

    const fail = await router.commit(intent, 'tx-collab-2', {
      applyAssembly: vi.fn(),
      addComposerReference: vi.fn(),
      // 无 owner → fail-close
    });
    expect(fail.status).toBe('failed');
    expect(fail.message).toContain('不支持接收引用');
  });

  it('fails closed when no external import owner exists', async () => {
    const router = new DropCommitRouter();
    const receipt = await router.commit(
      {
        kind: 'external-import',
        targetId: 'capture:inbox',
        owner: 'capture',
        payload: { kind: 'url', value: 'https://example.com' },
      },
      'tx-import',
      { applyAssembly: vi.fn(), addComposerReference: vi.fn() },
    );
    expect(receipt).toMatchObject({
      status: 'failed',
      message: '当前没有可用的导入/捕获 owner',
    });
  });
});
