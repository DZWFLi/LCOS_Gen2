// A10 — LCOS host runtime lifecycle tests.
// - build once; re-render does not re-build (host references stay stable)
// - switchProject destroys old host (dispose) and builds a new one
// - dispose clears reconciler timer + marks disposed
// - config change (token/url) rebuilds without leaking the old client

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLcosHostRuntime,
  DOCK_GAP_REGISTRY,
  type LcosEndpointConfig,
  type CreateLcosRuntimeDeps,
  type LcosHostRuntime,
} from '../src/host/createLcosHostRuntime.js';
import type { Gen2Host } from '../src/host/projectionFacade.js';

interface FakeHostLike {
  id: number;
  reconciler: { dispose(): void; getProjectId(): string };
  projectLabel: string;
}

function gen2Like(id: number, projectId: string): Gen2Host {
  return {
    id,
    projectLabel: `project:${projectId}`,
    reconciler: {
      dispose() {
        // dispose sets a flag so tests can assert it ran
        (gen2Like as unknown as { disposedIds: number[] }).disposedIds.push(id);
      },
      getProjectId() {
        return projectId;
      },
    },
  } as unknown as Gen2Host;
}
(gen2Like as unknown as { disposedIds: number[] }).disposedIds = [];

const dirtyGen2Like = (gen2Like as unknown as { disposedIds: number[] });

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
      return gen2Like(builds, pid);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  const first = rt.host;
  void rt.host; // re-reads must not trigger any build
  void rt.projectId;
  assert.equal(builds, 1, 'one build on create');
  assert.equal((rt.host as unknown as FakeHostLike).id, 1);
  assert.equal(rt.projectId, 'p1');
  assert.equal(rt.disposed, false);
});

test('switchProject disposes the old host and builds a new one for the new project', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  const oldHost = rt.host;
  rt.switchProject('p2');
  assert.equal(builds, 2, 'switch builds a second host');
  assert.equal(rt.projectId, 'p2');
  assert.notEqual(rt.host, oldHost, 'new project gets a fresh host');
  assert.deepEqual(
    dirtyGen2Like.disposedIds,
    [1],
    'old host reconciler was disposed exactly once',
  );
});

test('switchProject to the SAME project is a no-op (no dispose, no rebuild)', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  rt.switchProject('p1');
  assert.equal(builds, 1, 'same project does not rebuild');
  assert.deepEqual(dirtyGen2Like.disposedIds, [], 'no dispose on same project');
});

test('dispose clears reconciler + marks disposed; further switches are ignored', () => {
  dirtyGen2Like.disposedIds = [];
  let builds = 0;
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      builds++;
      return gen2Like(builds, pid);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  rt.dispose();
  assert.equal(rt.disposed, true);
  assert.deepEqual(dirtyGen2Like.disposedIds, [1]);
  rt.switchProject('p2');
  assert.equal(builds, 1, 'no build after dispose');
  assert.equal(rt.projectId, 'p1');
});

test('config change (new token/url) rebuilds a host against the new config', () => {
  const built: string[] = [];
  const deps: CreateLcosRuntimeDeps = {
    build: (cfg, pid) => {
      built.push(`${cfg.coreToken}@${cfg.coreUrl}/p:${pid}`);
      return gen2Like(built.length, pid);
    },
  };
  const rt = createLcosHostRuntime(deps, ENDPOINT, 'p1');
  assert.equal(built.length, 1);
  const newConfig: LcosEndpointConfig = {
    ...ENDPOINT,
    coreToken: 'fresh-token',
  };
  const rt2 = createLcosHostRuntime(deps, newConfig, 'p1');
  assert.equal(built.length, 2, 'a fresh runtime with new config builds against it');
  assert.deepEqual(built[1], 'fresh-token@/lcos-core/p:p1');
  void rt; // unused var guard
});

test('dock gap registry freezes: no dock fabricated by UI in Phase A', () => {
  for (const row of DOCK_GAP_REGISTRY) {
    assert.equal(row.uiFabricated, false, `${row.dock} must not be UI-fabricated in Phase A`);
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
