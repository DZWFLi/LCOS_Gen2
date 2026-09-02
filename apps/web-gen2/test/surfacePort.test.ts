// A08 — Surface Port tests: 三现场共享协议但不共享状态。一个 Huabu runtime
// 装载三种 canvas identity；projectId 相同、key 不同 canvasId 必须不同。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SurfaceRegistry,
  type SurfaceDescriptor,
  type SurfacePorts,
  type SurfaceKeyName,
  type SurfaceCapability,
} from '../src/spatial/surfacePort.js';

function port(key: SurfaceKeyName, canvasId: string, caps: SurfaceCapability[]): SurfaceDescriptor {
  return {
    key,
    label: key,
    canvasId,
    capabilities: new Set(caps),
  };
}

function registryFor(projectId: string, byKey: (k: SurfaceKeyName) => SurfaceDescriptor): SurfaceRegistry {
  return new SurfaceRegistry({ portFor: byKey }, projectId);
}

const distinct = (k: SurfaceKeyName): SurfaceDescriptor => {
  // 构造与 project 'p1' 组合后的独立 canvasId，满足 F-SURFACE §10 分布
  const toCanvas: Record<SurfaceKeyName, string> = {
    main: 'p1-main-canvas',
    context: 'p1-context-canvas',
    workflow: 'p1-workflow-canvas',
  };
  return port(k, toCanvas[k], []);
};

test('current resolves each named surface to its port', () => {
  const reg = registryFor('p1', distinct);
  assert.equal(reg.current('main').canvasId, 'p1-main-canvas');
  assert.equal(reg.current('context').canvasId, 'p1-context-canvas');
  assert.equal(reg.current('workflow').canvasId, 'p1-workflow-canvas');
});

test('all() surfaces are mutually distinct canvas identities (same project, one runtime)', () => {
  const reg = registryFor('p1', distinct);
  const all: SurfacePorts = reg.all();
  const ids = new Set([all.main.canvasId, all.context.canvasId, all.workflow.canvasId]);
  assert.equal(ids.size, 3, 'same project -> distinct canvasId per surface (F-SURFACE §10)');
});

test('fails closed when two surfaces collide on the same canvasId', () => {
  assert.throws(
    () => registryFor('p1', (k) => port(k, 'same-canvas', [])),
    /collision|distinct canvasId/i,
  );
});

test('hasCapability reflects the surface descriptor capabilities', () => {
  const byKey = (k: SurfaceKeyName): SurfaceDescriptor => {
    const caps: SurfaceCapability[] =
      k === 'main' ? ['place-artifact', 'compose-run', 'open-work-view'] :
      k === 'context' ? ['inspect-context'] :
      ['edit-workflow', 'open-work-view'];
    return port(k, `${k}-canvas`, caps);
  };
  const reg = registryFor('p1', byKey);
  assert.equal(reg.current('main').hasCapability('place-artifact'), true);
  assert.equal(reg.current('main').hasCapability('edit-workflow'), false);
  assert.equal(reg.current('context').hasCapability('inspect-context'), true);
  assert.equal(reg.current('context').hasCapability('open-work-view'), false);
  assert.equal(reg.current('workflow').hasCapability('edit-workflow'), true);
});

test('unknown key fails closed rather than silently falling back', () => {
  const reg = registryFor('p1', distinct);
  const bad = reg as unknown as { current(k: 'bogus'): unknown };
  assert.throws(() => bad.current('bogus'), /unavailable/);
});

test('same project can host the same artifact across surfaces (distinct canvasId, binding-keyed)', () => {
  // 跨现场的 artifact 可共存，因为 binding 由 projectId+canvasId+entity 三元组
  // 唯一；注册表保证 canvasId 不同即不冲突。
  const reg = registryFor('p1', distinct);
  assert.equal(reg.current('main').canvasId, 'p1-main-canvas');
  assert.equal(reg.current('context').canvasId, 'p1-context-canvas');
  assert.notEqual(reg.current('main').canvasId, reg.current('context').canvasId);
});
