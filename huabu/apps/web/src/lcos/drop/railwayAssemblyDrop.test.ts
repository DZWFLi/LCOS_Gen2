import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLcosDropStore } from '../lcosDropState';
import { ASSEMBLY_DRAG_MIME } from './nativeAssemblyDrop';
import { beginRailwayAssemblyDrop, cancelRailwayAssemblyDrop, railwayAggregatePayload, railwayAssemblyPayload } from './railwayAssemblyDrop';

import type { AssemblySourceRefV1, RailwayDestinationV1 } from '@local-creative-os/contracts';

const worksite: RailwayDestinationV1 = {
  key: 'worksite:ws-1', ref: { kind: 'worksite', projectId: 'project-1', worksiteId: 'ws-1' },
  label: '项目现场', role: 'worksite', available: true, workspaceId: 'ws-1', canvasId: 'canvas-1', accepts: ['artifactView', 'note'],
};

function dragStartEvent(setData = vi.fn()) {
  return {
    dataTransfer: { effectAllowed: 'none' as DataTransfer['effectAllowed'], setData },
    preventDefault: vi.fn(),
  };
}

afterEach(() => useLcosDropStore.getState().reset());

describe('Railway aggregate source reuses the existing Assembly drop owner', () => {
  it('preserves each aggregate family as one canonical reference without expanding its members', () => {
    const cases = [
      [{ kind: 'scene', id: 'workspace-1' }, 'workspace'],
      [{ kind: 'context', id: 'scope-context' }, 'scope'],
      [{ kind: 'workflow', id: 'scope-workflow' }, 'scope'],
      [{ kind: 'collection', id: 'collection-1' }, 'collection'],
    ] as const;
    for (const [sourceRef, entityType] of cases) {
      const id = sourceRef.id;
      const payload = railwayAggregatePayload({ projectId: 'project-1', sourceRef: sourceRef as AssemblySourceRefV1,
        entityRef: { type: entityType, id }, label: id, available: true }, 'project-1');
      expect(payload).toMatchObject({ kind: 'assembly', sourceRef, entityRef: { type: entityType, id }, reference: { entityType, entityId: id } });
      expect(payload && Object.isFrozen(payload)).toBe(true);
      expect(payload && Object.isFrozen(payload.sourceRef)).toBe(true);
      expect(payload && Object.isFrozen(payload.entityRef)).toBe(true);
    }
    expect(railwayAggregatePayload({ projectId: 'other', sourceRef: {kind:'scene',id:'w'}, entityRef:{type:'workspace',id:'w'}, label:'other', available: true }, 'project-1')).toBeUndefined();
    expect(railwayAggregatePayload({ projectId: 'project-1', sourceRef: {kind:'collection',id:''}, entityRef:{type:'collection',id:''}, label:'empty', available: true }, 'project-1')).toBeUndefined();
  });

  it('captures one canonical workspace as one frozen scene reference and starts the existing gesture', () => {
    const event = dragStartEvent();
    expect(beginRailwayAssemblyDrop(event, worksite, 'project-1')).toBe(true);
    expect(event.dataTransfer.effectAllowed).toBe('copy');
    expect(event.dataTransfer.setData).toHaveBeenCalledWith(ASSEMBLY_DRAG_MIME, JSON.stringify({
      itemId: 'ws-1', sourceRef: { kind: 'scene', id: 'ws-1' },
      entityRef: { type: 'workspace', id: 'ws-1' },
      reference: { entityType: 'workspace', entityId: 'ws-1', displayLabel: '项目现场' },
    }));
    const state = useLcosDropStore.getState().state;
    expect(state).toMatchObject({ status: 'tracking', payload: { kind: 'assembly', itemId: 'ws-1', sourceRef: { kind: 'scene', id: 'ws-1' } } });
    if (!('payload' in state) || state.payload.kind !== 'assembly') throw new Error('Expected the existing assembly payload');
    expect(Object.isFrozen(state.payload)).toBe(true);
    expect(Object.isFrozen(state.payload.sourceRef)).toBe(true);
    expect(Object.isFrozen(state.payload.entityRef)).toBe(true);
    expect(Object.isFrozen(state.payload.reference)).toBe(true);
  });

  it('refuses root, receiver, legacy, wrong-project, mismatched-workspace and unavailable rows', () => {
    const invalid: RailwayDestinationV1[] = [
      { ...worksite, role: 'surface', ref: { kind: 'surface_root', projectId: 'project-1', surface: 'context' } },
      { ...worksite, role: 'receiver', ref: { kind: 'receiver_conversation', projectId: 'project-1', connectedConversationId: 'conversation-1' } },
      { ...worksite, role: 'legacy', ref: { kind: 'legacy', projectId: 'project-1', legacyKind: 'scene', legacyViewId: 'old', raw: {} } },
      { ...worksite, ref: { kind: 'worksite', projectId: 'other-project', worksiteId: 'ws-1' } },
      { ...worksite, workspaceId: 'ws-other' },
      { ...worksite, available: false },
    ];
    for (const destination of invalid) {
      const event = dragStartEvent();
      expect(railwayAssemblyPayload(destination, 'project-1')).toBeUndefined();
      expect(beginRailwayAssemblyDrop(event, destination, 'project-1')).toBe(false);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.dataTransfer.setData).not.toHaveBeenCalled();
    }
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });

  it('uses Core-projected sourceRef for a spatial destination instead of guessing its aggregate kind', () => {
    const destination: RailwayDestinationV1 = {
      key: 'spatial:scope-1', ref: { kind: 'spatial', projectId: 'project-1', entityType: 'scope', entityId: 'scope-1' },
      sourceRef: { kind: 'workflow', id: 'scope-1' }, receiveTarget: { owner: 'assembly', targetRef: { kind: 'workflow', id: 'scope-1' } },
      label: 'Workflow scope', role: 'spatial', available: true, accepts: [],
    };
    expect(railwayAssemblyPayload(destination, 'project-1')).toMatchObject({
      kind: 'assembly', sourceRef: { kind: 'workflow', id: 'scope-1' }, entityRef: { type: 'scope', id: 'scope-1' },
    });
    expect(railwayAssemblyPayload({ ...destination, sourceRef: { kind: 'context', id: 'another-scope' } }, 'project-1')).toBeUndefined();
  });

  it('does not begin a second source while the existing owner is committing', () => {
    const first = railwayAssemblyPayload(worksite, 'project-1');
    if (!first) throw new Error('Expected valid worksite source');
    useLcosDropStore.setState({ state: { status: 'committing', payload: first,
      destination: { targetId: 'receiver:1', previewPoint: { x: 1, y: 1 } }, carryAnchor: 'left',
      intent: { kind: 'assembly-apply', targetId: 'receiver:1' }, transactionId: 'tx-1' } });
    const event = dragStartEvent();
    expect(beginRailwayAssemblyDrop(event, worksite, 'project-1')).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.dataTransfer.setData).not.toHaveBeenCalled();
    expect(useLcosDropStore.getState().state.status).toBe('committing');
  });

  it('dragend cancels only its matching pending source and leaves another source untouched', () => {
    const event = dragStartEvent();
    expect(beginRailwayAssemblyDrop(event, worksite, 'project-1')).toBe(true);
    expect(cancelRailwayAssemblyDrop({ ...worksite, ref: { kind: 'worksite', projectId: 'project-1', worksiteId: 'ws-other' }, workspaceId: 'ws-other' }, 'project-1')).toBe(false);
    expect(useLcosDropStore.getState().state.status).toBe('tracking');
    expect(cancelRailwayAssemblyDrop({ ...worksite, available: false }, 'project-1')).toBe(true);
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });

  it('does not acquire the gesture if writing its transport snapshot fails', () => {
    const setData = vi.fn().mockImplementation(() => { throw new Error('DataTransfer unavailable'); });
    const event = dragStartEvent(setData);
    expect(beginRailwayAssemblyDrop(event, worksite, 'project-1')).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });
  it.each(['collection', 'context', 'workflow'] as const)('clears a cancelled native %s carrier even after it becomes unavailable', (kind) => {
    const id = `source-${kind}`;
    const destination: RailwayDestinationV1 = {
      key: id, ref: {kind:'spatial',projectId:'project-1',entityType:kind==='collection'?'collection':'scope',entityId:id},
      sourceRef:{kind,id},label:id,role:'spatial',available:true,accepts:[],
    };
    expect(beginRailwayAssemblyDrop(dragStartEvent(),destination,'project-1')).toBe(true);
    expect(cancelRailwayAssemblyDrop({...destination,available:false},'other-project')).toBe(false);
    expect(useLcosDropStore.getState().state.status).toBe('tracking');
    expect(cancelRailwayAssemblyDrop({...destination,available:false},'project-1')).toBe(true);
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });

  it('does not overwrite a pending pointer or native source with another native drag', () => {
    expect(beginRailwayAssemblyDrop(dragStartEvent(),worksite,'project-1')).toBe(true);
    const first = useLcosDropStore.getState().state;
    const second = dragStartEvent();
    expect(beginRailwayAssemblyDrop(second,worksite,'project-1')).toBe(false);
    expect(second.dataTransfer.setData).not.toHaveBeenCalled();
    expect(useLcosDropStore.getState().state).toBe(first);
  });

  it('does not cancel a committing spatial carrier or another entity family with the same id', () => {
    const destination: RailwayDestinationV1 = {
      key:'collection:ws-1',ref:{kind:'spatial',projectId:'project-1',entityType:'collection',entityId:'ws-1'},
      sourceRef:{kind:'collection',id:'ws-1'},label:'collection',role:'spatial',available:true,accepts:[],
    };
    expect(beginRailwayAssemblyDrop(dragStartEvent(),destination,'project-1')).toBe(true);
    expect(cancelRailwayAssemblyDrop(worksite,'project-1')).toBe(false);
    const state=useLcosDropStore.getState().state;
    if(!('payload' in state))throw new Error('Expected captured payload');
    useLcosDropStore.setState({state:{status:'committing',payload:state.payload,
      destination:{targetId:'canvas:main',previewPoint:{x:1,y:1}},carryAnchor:'left',
      intent:{kind:'assembly-apply',targetId:'canvas:main'},transactionId:'tx-spatial'}});
    expect(cancelRailwayAssemblyDrop(destination,'project-1')).toBe(false);
    expect(useLcosDropStore.getState().state.status).toBe('committing');
  });

});
