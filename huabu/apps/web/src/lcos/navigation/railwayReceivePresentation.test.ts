import { describe, expect, it } from 'vitest';

import { railwayReceiveLabel, railwayReceivePresentation } from './railwayReceivePresentation';

import type { DropTargetCandidate } from '../drop/dropTypes';
import type { DropPayload, SemanticDropState } from '@local-creative-os/web-gen2';

const targetId = 'railway:project-1:worksite-2';
const candidate: DropTargetCandidate = {
  targetId,
  enabled: true,
  semantic: {
    kind: 'railway-receive',
    targetRef: { kind: 'workspace', id: 'worksite-2' },
    destinationRef: { kind: 'worksite', projectId: 'project-1', worksiteId: 'worksite-2' },
    canvasId: 'canvas-2', orderVersion: 3, accepts: ['artifactView', 'note'],
  },
};

const scene: DropPayload = {
  kind: 'assembly', itemId: 'worksite-1', sourceRef: { kind: 'scene', id: 'worksite-1' },
  entityRef: { type: 'workspace', id: 'worksite-1' },
  reference: { entityType: 'workspace', entityId: 'worksite-1' },
};
const note: DropPayload = {
  kind: 'assembly', itemId: 'note-1', sourceRef: { kind: 'note', id: 'note-1' },
  entityRef: { type: 'note', id: 'note-1' },
  reference: { entityType: 'note', entityId: 'note-1' },
};

function tracking(payload: DropPayload): SemanticDropState {
  return { status: 'tracking', payload };
}

describe('Railway receive feedback follows the shared resolver per destination', () => {
  it('uses the shared resolver outcome for the exact hot destination', () => {
    const state: SemanticDropState = {
      status: 'preview', payload: { kind: 'object', entityType: 'artifact', entityId: 'a-1' },
      destination: { targetId, previewPoint: { x: 1, y: 2 } }, carryAnchor: 'left',
    };
    expect(railwayReceivePresentation({ targetId, enabled: true, dropState: state, resolution: {
      status: 'ready', intent: { kind: 'assembly-apply', targetId,
        targetRef: { kind: 'workspace', id: 'worksite-2' }, sourceRefs: [{ kind: 'artifactView', id: 'view-a1' }],
        railwayReceive: true, railwayDestinationRef: { kind: 'worksite', projectId: 'project-1', worksiteId: 'worksite-2' },
      },
    }, candidate })).toBe('receive-hot');
  });

  it('marks a scene source ineligible at the material-only Railway receiver', () => {
    expect(railwayReceivePresentation({ targetId, enabled: true, dropState: tracking(scene), resolution: null, candidate }))
      .toBe('ineligible');
  });

  it('keeps a supported note source in the searching state until hover resolves it', () => {
    expect(railwayReceivePresentation({ targetId, enabled: true, dropState: tracking(note), resolution: null, candidate }))
      .toBe('receive');
  });

  it('fails closed when an active source has no exact per-target candidate', () => {
    expect(railwayReceivePresentation({ targetId, enabled: true, dropState: tracking(note), resolution: null }))
      .toBe('ineligible');
  });

  it('keeps unavailable destinations fail-closed and exposes user language', () => {
    const presentation = railwayReceivePresentation({ targetId, enabled: false,
      dropState: { status: 'idle' }, resolution: null, candidate: { ...candidate, enabled: false, ineligibleReason: '目标已归档' } });
    expect(presentation).toBe('ineligible');
    expect(railwayReceiveLabel(presentation, '目标已归档')).toBe('目标已归档');
  });

  it('does not assign a targetless failure to every destination', () => {
    expect(railwayReceivePresentation({ targetId, enabled: true,
      dropState: { status: 'failed', reason: 'network', recoverable: true }, resolution: null, candidate })).toBe('rest');
  });
});
