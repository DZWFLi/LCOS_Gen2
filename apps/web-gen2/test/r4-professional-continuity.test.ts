import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProfessionalStageRegionPlacementsV1 as place, professionalFloatingBoundsV1 as bounds, needsCompactProfessionalStageV1 as compact, professionalDockWidth } from '../../../huabu/apps/web/src/lcos/professional/professionalWindowStageLayout.js';
import { clampProfessionalSplitRatio as ratio, professionalSplitRatioAtPoint, sameProfessionalRegionLayout, isFiniteProfessionalRect } from '../../../huabu/apps/web/src/lcos/professional/professionalGestureGeometry.js';
import { resolveProfessionalWindowDropTarget as hit, sameProfessionalDropTarget } from '../../../huabu/apps/web/src/lcos/professional/professionalWindowDropTarget.js';
import { beginProfessionalPointerGesture } from '../../../huabu/apps/web/src/lcos/professional/professionalPointerGesture.js';
import { createWindowRegion, activateRegionWindow, reorderRegionWindowBefore, mergeRegionGroups, splitRegionGroup } from '../../../huabu/apps/web/src/lcos/shell/windowRegionTopology.js';
import { readProfessionalWindowLayout, writeProfessionalWindowLayout } from '../../../huabu/apps/web/src/lcos/professional/professionalWindowPersistence.js';
import { zoomImageAtPoint, fitImageInStage, imageWheelFactor, centerImageAfterResize } from '../../../huabu/apps/web/src/lcos/ui/professional/donor/imageZoomMath.js';
import { readerTabScrollLeft } from '../../../huabu/apps/web/src/lcos/ui/professional/readerTabScroll.js';

const viewport = { x: 0, y: 0, width: 1440, height: 900 };
const input = (bodyKey = 'reader') => ({ regionId: 'r', layout: 'floating' as const, preferredWidth: bodyKey === 'reader' ? 1120 : 640, bodyKey });
const inside = (a: typeof viewport, b: typeof viewport) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width + 1e-8 && a.y + a.height <= b.y + b.height + 1e-8;

test('R4: Reader initial footprint uses the actual Figma 5388:27475 frame', () => assert.deepEqual(place({ viewport, regions: [input()] })[0]?.rect, { x: 176, y: 116, width: 1120, height: 672 }));
test('R4: Assembly preserves the adopted C01 footprint rather than taking Reader dimensions', () => assert.deepEqual(place({ viewport, regions: [input('assembly')] })[0]?.rect, { x: 704, y: 120, width: 640, height: 648 }));
for (const [width, height] of [[390, 700], [760, 500], [200, 100], [1440, 240], [40, 20]]) test(`R4: all floating controls remain in ${width}x${height}`, () => {
  const v = { ...viewport, width: width!, height: height! };
  const r = place({ viewport: v, regions: [input()] })[0]!.rect;
  assert(isFiniteProfessionalRect(r)); assert(inside(r, v)); assert(inside(bounds(v), v));
});
test('R4: an invalid/offscreen saved rectangle is never restored as NaN or behind the top bar', () => {
  const r = place({ viewport, regions: [{ ...input(), rect: { x: -900, y: -900, width: 500, height: 400 } }] })[0]!.rect;
  assert(inside(r, bounds(viewport)));
  assert.deepEqual(place({ viewport, regions: [{ ...input(), rect: { x: NaN, y: 0, width: 1, height: 1 } }] })[0]?.rect, place({ viewport, regions: [input()] })[0]?.rect);
});
test('R4: floating clearance uses actual resized dock width, not the old preferred width', () => {
  const v = { ...viewport, width: 1800 };
  const result = place({ viewport: v, regions: [{ ...input(), regionId: 'dock', layout: 'docked-right', preferredWidth: 520, dockWidth: 900 }, { ...input('assembly'), regionId: 'float' }] });
  const dock = result.find((r) => r.regionId === 'dock')!.rect, f = result.find((r) => r.regionId === 'float')!.rect;
  assert.equal(dock.width, 900); assert(f.x + f.width <= dock.x - 16);
});
test('R4: dock preview and final layout use the same width and canvas reserve', () => {
  const h = hit({ x: 1430, y: 400, sourceRegionId: 'x', viewport, preferredDockWidth: 2000, regions: [] })!;
  assert.equal(h.kind, 'dock-right');
  assert.equal(h.rect.width, professionalDockWidth(viewport, 2000));
  assert.deepEqual(h.rect, place({ viewport, regions: [{ ...input(), layout: 'docked-right', dockWidth: h.rect.width }] })[0]?.rect);
});
test('R4: overcrowded dock rows trigger compact presentation but never zero/negative heights', () => {
  const v = { ...viewport, height: 500 };
  const regions = [0, 1, 2].map((i) => ({ ...input(), regionId: `r${i}`, layout: 'docked-right' as const }));
  assert(compact(v, regions)); for (const p of place({ viewport: v, regions })) { assert(p.rect.height > 0); assert(inside(p.rect, v)); }
});
test('R4: two desktop floating windows keep a usable canvas reserve and do not overlap', () => {
  const [a, b] = place({ viewport, regions: [{ ...input(), regionId: 'a' }, { ...input(), regionId: 'b' }] });
  assert(a!.rect.x >= 160); assert(a!.rect.x + a!.rect.width <= b!.rect.x); assert(!compact(viewport, [input(), { ...input(), regionId: 'b' }]));
});
test('R4: narrow multi-region layout compacts without changing topology', () => assert(compact({ ...viewport, width: 600 }, [input(), { ...input(), regionId: 'b' }])));
test('R4: splitter ratio respects actual 360px pane floor and divider width', () => { assert.equal(ratio(0.1, 805, 'vertical'), 0.45); assert.equal(ratio(0.9, 805, 'vertical'), 0.55); assert.equal(ratio(NaN, 805, 'vertical'), 0.5); });
test('R4: infeasible split does not produce tiny twenty-percent columns', () => { assert.equal(ratio(0.2, 600, 'vertical'), 0.5); assert.equal(ratio(0.8, 400, 'horizontal'), 0.5); });
test('R4: pointer and keyboard share splitter limits', () => assert.equal(professionalSplitRatioAtPoint({ x: 100, y: 100, width: 805, height: 700 }, 'vertical', { x: -500, y: 200 }), 0.45));

const target = { regionId: 'target', rect: { x: 300, y: 100, width: 900, height: 700 }, canSplit: true,
  groups: [{ groupId: 'g', rect: { x: 300, y: 100, width: 900, height: 700 } }] };
const request = { sourceRegionId: 'source', viewport, preferredDockWidth: 520, regions: [target] };
for (const point of [{ x: 1500, y: 300 }, { x: 1430, y: -1 }, { x: NaN, y: 200 }, { x: 500, y: 901 }]) test(`R4: release outside viewport never docks (${point.x},${point.y})`, () => assert.equal(hit({ ...request, ...point }), undefined));
test('R4: split preview reserves real divider space', () => { const h = hit({ ...request, x: 305, y: 400 })!; assert.equal(h.kind, 'split'); assert.equal(h.rect.width, 447.5); });
test('R4: small targets offer a group, not a split that immediately collapses', () => {
  const small = { ...target, rect: { ...target.rect, width: 600 }, groups: [{ groupId: 'g', rect: { ...target.rect, width: 600 } }] };
  assert.equal(hit({ ...request, x: 305, y: 400, regions: [small] })?.kind, 'group');
});
test('R4: separator gaps are not guessed as the last pane', () => {
  const two = { ...target, canSplit: false, groups: [{ groupId: 'a', rect: { ...target.rect, width: 447.5 } }, { groupId: 'b', rect: { ...target.rect, x: 752.5, width: 447.5 } }] };
  assert.equal(hit({ ...request, x: 750, y: 400, regions: [two] }), undefined);
});
test('R4: tab-strip hit means insert before a concrete tab, never an edge split', () => {
  const t = { ...target, groups: [{ ...target.groups[0]!, tabs: [{ windowId: 'a', rect: { x: 310, y: 105, width: 104, height: 44 } }, { windowId: 'b', rect: { x: 420, y: 105, width: 104, height: 44 } }] }] };
  assert.deepEqual(hit({ ...request, regions: [t], x: 425, y: 110 }), { kind: 'group', regionId: 'target', groupId: 'g', rect: target.rect, previewRect: target.rect, beforeWindowId: 'b' });
  const end = hit({ ...request, regions: [t], x: 515, y: 110 }); assert(end?.kind === 'group'); assert.equal(end.beforeWindowId, null);
});
test('R4: a moved/replaced destination cannot reuse the old preview', () => {
  const a = hit({ ...request, x: 800, y: 400 });
  const b = hit({ ...request, x: 800, y: 400, regions: [{ ...target, regionId: 'replacement' }] });
  assert(!sameProfessionalDropTarget(a, b)); assert(!sameProfessionalDropTarget(a, undefined)); assert(sameProfessionalDropTarget(a, structuredClone(a)));
});
test('R4: source activation is allowed during a gesture but reparenting or resizing is not', () => {
  const a = createWindowRegion('r', ['a', 'b'], 'a');
  assert(sameProfessionalRegionLayout(a, activateRegionWindow(a, 'b')));
  assert(!sameProfessionalRegionLayout(a, { ...a, rect: { x: 0, y: 0, width: 500, height: 500 } }));
  assert(!sameProfessionalRegionLayout(a, createWindowRegion('r', ['b', 'a'], 'b')));
  assert(!sameProfessionalRegionLayout(a, undefined));
});
test('R4: direct tab reorder retains identity, selection and other tabs', () => {
  const a = createWindowRegion('r', ['a', 'b', 'c'], 'b');
  const b = reorderRegionWindowBefore(a, 'c', 'a'); assert.deepEqual(b.groups[0]?.windowIds, ['c', 'a', 'b']); assert.equal(b.groups[0]?.activeWindowId, 'b');
  assert.deepEqual(reorderRegionWindowBefore(b, 'c', null).groups[0]?.windowIds, ['a', 'b', 'c']);
  assert.equal(reorderRegionWindowBefore(a, 'b', 'b'), a); assert.equal(reorderRegionWindowBefore(a, 'a', 'stale'), a);
});
test('R4: split/merge uses existing owner and preserves every content tab', () => {
  const original = createWindowRegion('r', ['a', 'b', 'c'], 'b'); const split = splitRegionGroup(original, 'b', 'vertical'); const merged = mergeRegionGroups(split);
  assert.equal(split.groups.length, 2); assert.equal(merged.groups.length, 1); assert.equal(merged.groups[0]?.activeWindowId, 'b'); assert.deepEqual(new Set(merged.groups[0]?.windowIds), new Set(['a', 'b', 'c']));
});

function pointerFixture() {
  class Target extends EventTarget { visibilityState = 'visible'; captured = new Set<number>();
    setPointerCapture(id: number) { this.captured.add(id); } hasPointerCapture(id: number) { return this.captured.has(id); } releasePointerCapture(id: number) { this.captured.delete(id); } }
  const win = new Target(), doc = new Target(), cap = new Target(); let current = true;
  const calls: string[] = [];
  const send = (target: Target, type: string, fields: Record<string, unknown> = {}) => { const e = new Event(type, { cancelable: true }); Object.assign(e, { pointerId: 1, clientX: 50, clientY: 50, button: 0, buttons: 1, ...fields }); target.dispatchEvent(e); return e; };
  const cancel = beginProfessionalPointerGesture({ start: { pointerId: 1, button: 0, clientX: 0, clientY: 0 }, capture: cap as unknown as HTMLElement, window: win as unknown as Window, document: doc as unknown as Document,
    isCurrent: () => current, onMove: () => calls.push('move'), onCommit: () => calls.push('commit'), onCancel: (reason) => calls.push(reason) });
  return { win, doc, cap, calls, send, cancel, stale: () => { current = false; } };
}
test('R4: exactly one pointer owns a window gesture', () => { const f = pointerFixture(); f.send(f.win, 'pointermove', { pointerId: 2 }); f.send(f.win, 'pointerup', { pointerId: 2 }); assert.deepEqual(f.calls, []); f.send(f.win, 'pointermove'); f.send(f.win, 'pointerup'); f.send(f.win, 'pointerup'); assert.deepEqual(f.calls, ['move', 'commit']); assert(!f.cap.hasPointerCapture(1)); });
for (const [event, reason] of [['pointercancel','pointer-cancel'],['blur','blur'],['resize','viewport-change']]) test(`R4: ${event} cancels instead of committing latest preview`, () => { const f = pointerFixture(); f.send(f.win, 'pointermove'); f.send(f.win, event!); f.send(f.win, 'pointerup'); assert.deepEqual(f.calls, ['move', reason]); });
test('R4: Escape consumes the gesture before the close-window stack', () => { const f = pointerFixture(); const event = f.send(f.doc, 'keydown', { key: 'Escape' }); assert(event.defaultPrevented); assert.deepEqual(f.calls, ['escape']); f.send(f.win, 'pointerup'); assert.deepEqual(f.calls, ['escape']); });
test('R4: composition Escape does not accidentally end a pointer session', () => { const f = pointerFixture(); f.send(f.doc, 'keydown', { key: 'Escape', isComposing: true }); assert.deepEqual(f.calls, []); f.cancel(); });
test('R4: hidden-document cancels and later pointerup does nothing', () => { const f = pointerFixture(); f.doc.visibilityState = 'hidden'; f.send(f.doc, 'visibilitychange'); f.send(f.win, 'pointerup'); assert.deepEqual(f.calls, ['hidden']); });
test('R4: stale project/topology invalidates the release', () => { const f = pointerFixture(); f.stale(); f.send(f.win, 'pointerup'); assert.deepEqual(f.calls, ['stale-source']); });
test('R4: lost primary button or capture cancels exactly once', () => { const f = pointerFixture(); f.send(f.win, 'pointermove', { buttons: 0 }); f.send(f.cap, 'lostpointercapture'); f.cancel(); assert.deepEqual(f.calls, ['button-lost']); const g = pointerFixture(); g.send(g.cap, 'lostpointercapture'); assert.deepEqual(g.calls, ['capture-lost']); });
test('R4: a secondary-button pointerup cannot commit the primary gesture', () => { const f = pointerFixture(); f.send(f.win, 'pointerup', { button: 2 }); assert.deepEqual(f.calls, []); f.cancel(); assert.deepEqual(f.calls, ['replaced']); });

test('R4: trackpad horizontal/zero delta is a no-op, not a zoom-out', () => { assert.equal(imageWheelFactor(0,0,500),1); assert.equal(imageWheelFactor(NaN,0,500),1); });
test('R4: wheel line/pixel units normalize without one fixed jump per tiny event', () => { assert.equal(imageWheelFactor(1,1,500), imageWheelFactor(16,0,500)); assert(imageWheelFactor(-1,0,500) < imageWheelFactor(-100,0,500)); });
test('R4: image zoom retains the same source point underneath the pointer', () => { const p={x:100,y:150}, view={scale:0.5,pan:{x:10,y:20}}; const n=zoomImageAtPoint(view.scale,view.pan,p,1.5,0.1,8); assert.equal((p.x-n.pan.x)/n.scale,(p.x-view.pan.x)/view.scale); assert.equal((p.y-n.pan.y)/n.scale,(p.y-view.pan.y)/view.scale); });
test('R4: resize retains manual image center without changing zoom', () => { const v={scale:2,pan:{x:-200,y:-100}};const n=centerImageAfterResize(v,{x:400,y:300},{x:600,y:500});assert.deepEqual(n,{scale:2,pan:{x:-100,y:0}}); });
test('R4: fitting a hidden or unloaded image does not manufacture scale zero', () => { assert.equal(fitImageInStage(0,0,1000,500),undefined); assert.equal(fitImageInStage(500,500,0,0),undefined); assert.equal(fitImageInStage(500,500,2000,1000)?.scale,0.25); });
test('R4: invalid zoom inputs never poison a valid image transform', () => { const v={x:10,y:20}; assert.deepEqual(zoomImageAtPoint(1,v,{x:1,y:1},NaN,.2,8),{scale:1,pan:v}); });
test('R4: selected Reader tab reveals only within its own scroller', () => { assert.equal(readerTabScrollLeft({scrollLeft:0,viewportWidth:220,scrollWidth:600,tabLeft:440,tabWidth:104}),324); assert.equal(readerTabScrollLeft({scrollLeft:324,viewportWidth:220,scrollWidth:600,tabLeft:0,tabWidth:104}),0); });
test('R4: visible/hidden oversized tabs do not reset valid scroll position', () => { assert.equal(readerTabScrollLeft({scrollLeft:30,viewportWidth:220,scrollWidth:600,tabLeft:40,tabWidth:104}),30); assert.equal(readerTabScrollLeft({scrollLeft:30,viewportWidth:0,scrollWidth:600,tabLeft:40,tabWidth:104}),30); });

test('R4: existing layout persistence survives real JSON reload with exact Reader revisions/groups', () => {
  const memory=new Map<string,string>();const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:(k:string,v:string)=>memory.set(k,v),getItem:(k:string)=>memory.get(k)??null,removeItem:(k:string)=>memory.delete(k)}});
  try {
    const windows=[{id:'a',bodyKey:'reader' as const,title:'A',target:'artifact-a',readerRevisionId:'historical-a',active:false},{id:'b',bodyKey:'reader' as const,title:'B',target:'artifact-b',active:true}];
    const r=splitRegionGroup(createWindowRegion('r',['a','b'],'b'),'b','vertical');
    writeProfessionalWindowLayout('p',windows,[{...r,rect:{x:176,y:116,width:1120,height:672}}]);
    const result=readProfessionalWindowLayout('p'); assert.equal(result?.windows[0]?.readerRevisionId,'historical-a'); assert.equal(result?.windowRegions[0]?.groups.length,2); assert.equal(readProfessionalWindowLayout('q'),undefined);
    const key=[...memory.keys()][0]!;const good=memory.get(key)!;
    const bad=JSON.parse(good); bad.windowRegions[0].groups[1].id=bad.windowRegions[0].groups[0].id;memory.set(key,JSON.stringify(bad));assert.equal(readProfessionalWindowLayout('p'),undefined);
    const badRegion=JSON.parse(good);badRegion.windowRegions=[createWindowRegion('r',['a'],'a'),createWindowRegion('r',['b'],'b')];memory.set(key,JSON.stringify(badRegion));assert.equal(readProfessionalWindowLayout('p'),undefined);
    memory.set(key,good);assert.deepEqual(readProfessionalWindowLayout('p'),result);
  } finally { if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage'); }
});
