import { describe, expect, it } from 'vitest';
import type { RailwayDestinationV1 } from '@local-creative-os/contracts';
import { resolveDropIntent } from '../drop/dropIntentResolver';
import { railwayDestinationCanReceive, railwayDestinationGlyph, railwayReceivePresentation } from './railwayReceivePresentation';

const collection: RailwayDestinationV1 = {
  key:'collection-1', ref:{kind:'spatial',projectId:'project-1',entityType:'collection',entityId:'collection-1'},
  role:'spatial',label:'参考集合',available:true,accepts:[],
  sourceRef:{kind:'collection',id:'collection-1'},
  receiveTarget:{owner:'collection-membership',collectionId:'collection-1'},
};

describe('Rail carrier admission and feedback use the same capability', () => {
  it('admits an explicitly pinned Collection without inventing a canvas', () => {
    expect(railwayDestinationCanReceive(collection,'main-canvas')).toBe(true);
    expect(railwayDestinationCanReceive(collection,undefined)).toBe(true);
    expect(railwayDestinationCanReceive({...collection,available:false},'main-canvas')).toBe(false);
  });

  it.each(['context','workflow'] as const)('admits an existing %s scope through its Assembly owner', (kind) => {
    const scope: RailwayDestinationV1 = {...collection,ref:{kind:'spatial',projectId:'project-1',entityType:'scope',entityId:'scope-1'},
      sourceRef:{kind,id:'scope-1'},receiveTarget:{owner:'assembly',targetRef:{kind,id:'scope-1'}}};
    expect(railwayDestinationCanReceive(scope,'main-canvas')).toBe(true);
  });

  it('retains current-workspace and unavailable-workspace restrictions', () => {
    const workspace: RailwayDestinationV1={key:'w',ref:{kind:'worksite',projectId:'project-1',worksiteId:'w'},
      role:'worksite',label:'现场',available:true,canvasId:'target',workspaceId:'w',accepts:['note']};
    expect(railwayDestinationCanReceive(workspace,'source')).toBe(true);
    expect(railwayDestinationCanReceive(workspace,'target')).toBe(false);
    expect(railwayDestinationCanReceive({...workspace,available:false},'source')).toBe(false);
    expect(railwayDestinationCanReceive({...workspace,accepts:[]},'source')).toBe(false);
  });

  it('paints the same Collection as eligible and then hot, using the actual resolver', () => {
    const payload={kind:'object' as const,entityType:'note',entityId:'note-1'};
    const candidate={targetId:'rail:collection',enabled:true,
      semantic:{kind:'collection-membership' as const,collectionId:'collection-1'}};
    const resolution=resolveDropIntent(payload,candidate);
    const input={targetId:candidate.targetId,enabled:railwayDestinationCanReceive(collection,'main'),candidate,resolution};
    expect(railwayReceivePresentation({...input,dropState:{status:'tracking',payload}})).toBe('receive');
    expect(railwayReceivePresentation({...input,dropState:{status:'preview',payload,
      destination:{targetId:candidate.targetId,previewPoint:{x:12,y:12}},carryAnchor:'left'}})).toBe('receive-hot');
  });

  it('keeps busy/unregistered/rejected destinations ineligible instead of faking readiness', () => {
    const payload={kind:'object' as const,entityType:'note',entityId:'note-1'};
    const input={targetId:'rail:collection',enabled:true,dropState:{status:'tracking' as const,payload},resolution:null};
    expect(railwayReceivePresentation(input)).toBe('ineligible');
    expect(railwayReceivePresentation({...input,enabled:false})).toBe('ineligible');
    expect(railwayReceivePresentation({...input,candidate:{targetId:'rail:collection',enabled:true,
      semantic:{kind:'drop-exclusion',reason:'已移除'}}})).toBe('ineligible');
  });
});

it('uses canonical aggregate identity for glyphs instead of painting every spatial pin as a workspace', () => {
  expect(railwayDestinationGlyph(collection)).toBe('collection');
  expect(railwayDestinationGlyph({...collection,label:'工作流',sourceRef:{kind:'context',id:'scope-1'}})).toBe('context');
  expect(railwayDestinationGlyph({...collection,label:'集合',sourceRef:{kind:'workflow',id:'scope-1'}})).toBe('workflow');
  expect(railwayDestinationGlyph({...collection,role:'receiver'})).toBe('normal');
});
