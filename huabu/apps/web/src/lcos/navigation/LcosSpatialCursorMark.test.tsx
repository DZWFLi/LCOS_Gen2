import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { LcosSpatialCursorMark } from './LcosSpatialCursorMark';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => { if (root) act(() => root?.unmount()); host?.remove(); root=undefined; host=undefined; });
function render(surface:'main'|'context'|'workflow', phase:'near-edge'|'edge'|'arrival') {
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root?.render(<LcosSpatialCursorMark surface={surface} phase={phase} angleDeg={42} progress={.65} badge={4} label="上下文资料"/>));
  return host.querySelector<HTMLElement>('[data-lcos-spatial-cursor]')!;
}
describe('LcosSpatialCursorMark',()=>{
  it.each(['main','context','workflow'] as const)('retains the surface morphology for %s',surface=>{
    const el=render(surface,'edge');expect(el.dataset.lcosSpatialCursorSurface).toBe(surface);
    expect(el.querySelector('[data-lcos-spatial-cursor-ray]')).not.toBeNull();
    expect(el.querySelector('[data-lcos-spatial-cursor-badge]')?.textContent).toBe('4');
    expect(el.querySelector('[data-lcos-spatial-cursor-label]')?.textContent).toBe('上下文资料');
  });
  it('arrival keeps the same identity without a directional ray',()=>{
    const el=render('context','arrival');expect(el.querySelector('[data-lcos-spatial-cursor-ray]')).toBeNull();
    expect(el.querySelector('[data-lcos-spatial-cursor-glyph]')).not.toBeNull();
  });
});
