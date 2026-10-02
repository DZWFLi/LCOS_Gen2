import { describe, expect, it } from 'vitest';
import type { RailwayDestinationV1 } from '@local-creative-os/contracts';
import {
  railwayDropGestureActive,
  railwayDynamicCapacity,
  railwayHiddenDestinations,
  railwayVisibleDestinations,
} from './railwayDynamicLayout';

const destinations = Array.from({length:8},(_,index):RailwayDestinationV1=>({
  key:`k${index}`,
  ref:{kind:'worksite',projectId:'p',worksiteId:`w${index}`},
  label:`现场${index}`,
  role:'worksite',
  available:true,
  workspaceId:`w${index}`,
  canvasId:`c${index}`,
  accepts:['artifactView'],
}));

describe('dynamic Railway presentation',()=>{
  it('grows with the safe region instead of freezing to four items',()=>{
    expect(railwayDynamicCapacity({safeHeight:260,reservedHeight:150})).toBe(2);
    expect(railwayDynamicCapacity({safeHeight:800,reservedHeight:150})).toBeGreaterThan(4);
  });
  it('keeps the current worksite discoverable without changing canonical order',()=>{
    const visible=railwayVisibleDestinations(destinations,4,'w7');
    expect(visible.map((item)=>item.key)).toEqual(['k0','k1','k2','k7']);
    expect(railwayHiddenDestinations(destinations,visible).map((item)=>item.key)).toEqual(['k3','k4','k5','k6']);
    expect(destinations.map((item)=>item.key)).toEqual(['k0','k1','k2','k3','k4','k5','k6','k7']);
  });
  it('uses the shared Semantic Drop lifecycle to decide temporary receive expansion',()=>{
    expect(railwayDropGestureActive('idle')).toBe(false);
    expect(railwayDropGestureActive('failed')).toBe(false);
    expect(railwayDropGestureActive('tracking')).toBe(true);
    expect(railwayDropGestureActive('preview')).toBe(true);
    expect(railwayDropGestureActive('committing')).toBe(true);
  });
});
