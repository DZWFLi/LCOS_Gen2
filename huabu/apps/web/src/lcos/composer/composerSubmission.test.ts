import { describe, expect, it } from 'vitest';

import { buildComposerRunInput, canSubmitComposerTarget } from './composerSubmission';

const target = (receiverConversationId?: string) => ({
  nodeId: 'conversation-work-view',
  title: '会话',
  anchor: { x: 0, y: 0, width: 0, height: 0 },
  ...(receiverConversationId === undefined ? {} : { receiverConversationId }),
});

describe('shared Composer receiver mapping', () => {
  it('inline Work View session A creates a Run addressed to receiver A', () => {
    const payload = buildComposerRunInput({
      projectId: 'project-1',
      instruction: '继续整理',
      workspaceId: 'workspace-1',
      target: target('connected-A'),
      refs: [],
    });

    expect(payload.receiverRef).toEqual({ connectedConversationId: 'connected-A' });
  });

  it('does not allow send before the receiver is confirmed', () => {
    const blocked = { ...target(), receiverBlockedReason: 'receiver pending' };
    expect(canSubmitComposerTarget(blocked, '继续整理', 'workspace-1')).toBe(false);
  });

  it('switching from A to B never carries receiver A into the B payload', () => {
    const payload = buildComposerRunInput({
      projectId: 'project-1',
      instruction: '继续整理',
      workspaceId: 'workspace-1',
      target: target('connected-B'),
      refs: [],
    });

    expect(payload.receiverRef).toEqual({ connectedConversationId: 'connected-B' });
    expect(JSON.stringify(payload)).not.toContain('connected-A');
  });
});
