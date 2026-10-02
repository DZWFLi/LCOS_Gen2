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

  it('returns the disabled receiver so the resolver can explain rejection', () => {
    const registry = new DropTargetRegistry();
    registry.register({
      ...canvasTarget,
      enabled: false,
      ineligibleReason: '现场未就绪',
    });
    expect(registry.hitTest({ x: 10, y: 10 })?.enabled).toBe(false);
  });
});

describe('R1 single drop intent resolver', () => {
  it('resolves object to canvas and railway receive through assembly apply', () => {
    const payload = {
      kind: 'object',
      entityType: 'artifact',
      entityId: 'a-1',
      artifactViewId: 'view-a-1',
    } as const;
    const canvas = resolveDropIntent(payload, canvasTarget);
    const railway = resolveDropIntent(payload, railwayTarget);
    expect(canvas).toEqual({
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        targetId: 'canvas:main',
        targetRef: { kind: 'main' },
        sourceRefs: [{ kind: 'artifactView', id: 'view-a-1' }],
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

  it('CollaborationTarget（R1 合流）：Drop 到 Glyth = 持久加入该会话上下文（preview=execute）', () => {
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
      { kind: 'object', entityType: 'artifact', entityId: 'a-1', artifactViewId: 'view-a-1' },
      glyth,
    );
    // preview = execute：一次解析出 intent，commit 使用同一对象，无二次选择窗。
    expect(intent).toEqual({
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        targetId: 'glyth:node-1',
        targetRef: { kind: 'conversation', id: 'c-1' },
        sourceRefs: [{ kind: 'artifactView', id: 'view-a-1' }],
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
    const canonicalReceipt = { schemaVersion: 1 as const, projectId: 'p1', allApplied: true, changeSetId: 'cs-1', results: [{ sourceRef: { kind: 'artifactView' as const, id: 'a-1' }, status: 'applied' as const, channel: 'presentation-membership' as const }] };
    const applyAssembly = vi.fn(async () => canonicalReceipt);
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
    expect(first).toMatchObject({
      status: 'success',
      transactionId: 'tx-1',
      targetId: 'canvas:main',
      canonicalReceipt,
    });
    expect(second).toBe(first);
    expect(applyAssembly).toHaveBeenCalledTimes(1);
  });

  it('retired draft-only body intents cannot claim durable success', async () => {
    const router = new DropCommitRouter();
    const addConversationReference = vi.fn();
    const intent = {
      kind: 'collaboration-reference' as const,
      targetId: 'glyth:node-1',
      conversationId: 'c-1',
      reference: { entityType: 'artifact' as const, entityId: 'a-1' },
    };
    const ok = await router.commit(intent, 'tx-collab', {
      projectId: 'p', applyAssembly: vi.fn(),
      addComposerReference: vi.fn(),
      addConversationReference,
    });
    expect(ok).toMatchObject({ status: 'failed', transactionId: 'tx-collab' });
    expect(addConversationReference).not.toHaveBeenCalled();

    const fail = await router.commit(intent, 'tx-collab-2', {
      projectId: 'p', applyAssembly: vi.fn(),
      addComposerReference: vi.fn(),
      // 无 owner → fail-close
    });
    expect(fail.status).toBe('failed');
    expect(fail.message).toContain('旧会话投放请求已停用');
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
      { projectId: 'p', applyAssembly: vi.fn(), addComposerReference: vi.fn() },
    );
    expect(receipt).toMatchObject({
      status: 'failed',
      message: '当前没有可用的导入/捕获 owner',
    });
  });

  it('accepts collection membership only when the canonical receipt confirms this exact member', async () => {
    const router = new DropCommitRouter();
    const intent = {
      kind: 'collection-membership' as const,
      targetId: 'collection:c-1',
      collectionId: 'c-1',
      memberRef: { type: 'artifact' as const, id: 'a-1' },
    };
    const commit = (receipt: unknown) => router.commit(intent, `tx-${Math.random()}`, {
      projectId: 'p', applyAssembly: vi.fn(),
      addComposerReference: vi.fn(),
      addCollectionMember: vi.fn(async () => receipt as never),
    });

    await expect(commit({ status: 'applied', collectionId: 'c-1', memberRef: { type: 'artifact', id: 'a-1' } }))
      .resolves.toMatchObject({ status: 'success', message: '已加入集合' });
    await expect(commit({ status: 'already-member', collectionId: 'c-1', memberRef: { type: 'artifact', id: 'a-1' } }))
      .resolves.toMatchObject({ status: 'success', message: '已是集合成员' });
    await expect(commit({ status: 'not-member', collectionId: 'c-1', memberRef: { type: 'artifact', id: 'a-1' } }))
      .resolves.toMatchObject({ status: 'failed' });
    await expect(commit({ status: 'applied', collectionId: 'c-other', memberRef: { type: 'artifact', id: 'a-1' } }))
      .resolves.toMatchObject({ status: 'failed', message: '集合成员回执与本次投放对象不一致' });
    await expect(commit({ status: 'applied', collectionId: 'c-1', memberRef: { type: 'artifact', id: 'a-other' } }))
      .resolves.toMatchObject({ status: 'failed', message: '集合成员回执与本次投放对象不一致' });
  });
});

it('does not use an artifact ID as an ArtifactView ID for Assembly', () => {
  expect(resolveDropIntent({ kind: 'object', entityType: 'artifact', entityId: 'artifact-one' }, canvasTarget))
    .toMatchObject({ status: 'ineligible' });
  expect(resolveDropIntent({ kind: 'object', entityType: 'artifact', entityId: 'artifact-one', artifactViewId: 'view-seven' }, canvasTarget))
    .toMatchObject({ status: 'ready', intent: { sourceRefs: [{ kind: 'artifactView', id: 'view-seven' }] } });
});
