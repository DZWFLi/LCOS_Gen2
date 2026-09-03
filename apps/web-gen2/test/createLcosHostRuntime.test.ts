// A10 — LCOS host runtime lifecycle tests.
// - build once; re-render does not re-build (host references stay stable)
// - retarget({projectId}) destroys old host (dispose) and builds a new one
// - retarget({canvasId}) rebuilds within the same session (production start)
// - no-op when nothing changes; dispose clears reconciler timer + marks disposed

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLcosHostRuntime,
  DOCK_GAP_REGISTRY,
  type LcosEndpointConfig,
  type CreateLcosRuntimeDeps,
} from '../src/host/createLcosHostRuntime.js';
import type { Gen2Host } from '../src/host/projectionFacade.js';

interface FakeHostLike {
  id: number;
  reconciler: { dispose(): void; getProjectId(): string };
  projectLabel: string;
  canvasLabel: string;
}

function gen2Like(id: number, projectId: string, canvasId: string): Gen2Host {
  return {
    id,
    projectLabel: `project:${projectId}`,
    canvasLabel: `canvas:${canvasId}`,
    reconciler: {
      dispose() {
        (gen2Like as unknown as { disposedIds: number[] }).disposedIds.push(id);
      },
      getProjectId() {
        return projectId;
      },
    },
  } as unknown as Gen2Host;
}
(gen2Like as unknown as { disposedIds: number[] }).disposedIds = [];

const dirtyGen2Like = gen2Like as unknown as { disposedIds: number[] };

const ENDPOINT: LcosEndpointConfig = {
  coreUrl: '/lcos-core',
  coreToken: 'dev-token',
  rfsBaseUrl: '',
  rfsToken: 't',
  canvasId: 'c1',
};

test('builds once; repeated reads keep the same host (no re-build per render)', () => {
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid, cfg.canvasId);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  void rt.host;
  void rt.projectId;
  void rt.canvasId;
  assert.equal(builds, 1, 'one build on create');
  assert.equal((rt.host as unknown as FakeHostLike).id, 1);
  assert.equal(rt.projectId, 'p1');
  assert.equal(rt.canvasId, 'c1');
  assert.equal(rt.disposed, false);
});

test('retarget({projectId}) disposes the old host and builds a new one', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid, cfg.canvasId);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  const oldHost = rt.host;
  rt.retarget({ projectId: 'p2' });
  assert.equal(builds, 2, 'retarget project builds a second host');
  assert.equal(rt.projectId, 'p2');
  assert.equal(rt.canvasId, 'c1', 'canvas unchanged');
  assert.notEqual(rt.host, oldHost, 'new project gets a fresh host');
  assert.deepEqual(
    dirtyGen2Like.disposedIds,
    [1],
    'old host reconciler was disposed exactly once',
  );
});

test('retarget({canvasId}) rebuilds inside the same project session', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid, cfg.canvasId);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  rt.retarget({ canvasId: 'real-canvas-xyz' });
  assert.equal(builds, 2, 'canvas retarget rebuilds the host once');
  assert.equal(rt.canvasId, 'real-canvas-xyz');
  assert.equal(rt.projectId, 'p1', 'project unchanged');
  assert.equal(
    (rt.host as unknown as FakeHostLike).canvasLabel,
    'canvas:real-canvas-xyz',
  );
  assert.deepEqual(dirtyGen2Like.disposedIds, [1]);
});

test('retarget() with no delta is a no-op (no dispose, no rebuild)', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid, cfg.canvasId);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  rt.retarget({ projectId: 'p1', canvasId: 'c1' });
  assert.equal(builds, 1, 'no change does not rebuild');
  assert.deepEqual(dirtyGen2Like.disposedIds, [], 'no dispose on no-op');
});

test('dispose clears reconciler + marks disposed; further retargets are ignored', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid, cfg.canvasId);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  rt.dispose();
  assert.equal(rt.disposed, true);
  assert.deepEqual(dirtyGen2Like.disposedIds, [1]);
  rt.retarget({ projectId: 'p2', canvasId: 'c9' });
  assert.equal(builds, 1, 'no build after dispose');
  assert.equal(rt.projectId, 'p1');
  assert.equal(rt.canvasId, 'c1');
});

test('fresh runtime with new token/url config builds against it (no leaked client)', () => {
  const built: string[] = [];
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      built.push(`${cfg.coreToken}@${cfg.coreUrl}/p:${pid}`);
      return gen2Like(built.length, pid, cfg.canvasId);
    },
  };
  createLcosHostRuntime(deps, ENDPOINT, 'p1');
  assert.equal(built.length, 1);
  const newConfig: LcosEndpointConfig = {
    ...ENDPOINT,
    coreToken: 'fresh-token',
  };
  createLcosHostRuntime(deps, newConfig, 'p1');
  assert.equal(built.length, 2);
  assert.deepEqual(built[1], 'fresh-token@/lcos-core/p:p1');
});

test('dock gap registry freezes: no dock fabricated by UI in Phase A', () => {
  for (const row of DOCK_GAP_REGISTRY) {
    assert.equal(
      row.uiFabricated,
      false,
      `${row.dock} must not be UI-fabricated in Phase A`,
    );
    assert.ok(row.coreContract, `${row.dock} should point at a Core route`);
  }
});

test('dock gap registry has all five known Phase-C docks', () => {
  const docks = new Set(DOCK_GAP_REGISTRY.map((r) => r.dock));
  assert.deepEqual(
    [...docks].sort(),
    ['run', 'skill', 'voice', 'workbench', 'workflow'],
  );
});
