import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HuabuRfsClient } from '../src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../src/spatial/projectToSpaceProjection.js';
import { mimeTypeByArtifact, viewPresentationByArtifact } from '../src/spatial/reconciliationRunner.js';
import {
  MemoryBindingStore,
  ProjectionBindingRegistry,
} from '../src/spatial/projectionBinding.js';

const BASE = 'http://huabu.test';
const CANVAS = 'figma-geometry';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRfs(onCreate: (node: {
  nodeType: string;
  size: { width: number; height: number };
}) => void): HuabuRfsClient {
  let nextId = 0;
  const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
    if (body?.type === 'GET_SPACE_OUTLINE') {
      return jsonResponse({
        type: 'GET_SPACE_OUTLINE',
        result: { version: 1, bbox: null, nodes: [], edges: [], spatial: { clusters: [] } },
      });
    }
    if (body?.type === 'INSPECT_NODES') {
      return jsonResponse({
        type: 'INSPECT_NODES',
        result: { count: 0, total: 0, truncated: false, nodes: [] },
      });
    }
    const node = body?.commands?.[0]?.nodes?.[0];
    if (!node) throw new Error(`unexpected RFS body: ${JSON.stringify(body)}`);
    onCreate(node);
    nextId += 1;
    return jsonResponse({
      canvasId: CANVAS,
      runId: `run-${nextId}`,
      fromVersion: nextId - 1,
      toVersion: nextId,
      commands: [],
      results: [
        {
          index: 0,
          type: 'CREATE_NODES',
          applied: true,
          nodes: [{ nodeId: `node-${nextId}`, width: node.size.width, height: node.size.height }],
        },
      ],
      revisions: [],
      affected: { nodeIds: [`node-${nextId}`], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: [] },
    });
  };
  return new HuabuRfsClient({
    canvasId: CANVAS,
    baseUrl: BASE,
    bearerToken: 'token',
    fetch: fetchMock,
  });
}

test('new LCOS projections use exact Figma initial geometry, including image thumbnail variant', async () => {
  const created: { nodeType: string; size: { width: number; height: number } }[] = [];
  const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
  const projector = new ProjectToSpaceProjection(makeRfs((node) => created.push(node)), bindings);

  await projector.projectArtifacts([
    {
      projectId: 'p1',
      artifactId: 'image-main',
      kind: 'image',
      title: 'Main image',
      displayMode: 'card',
      size: { width: 360, height: 260 },
    },
    {
      projectId: 'p1',
      artifactId: 'image-thumb',
      kind: 'image',
      title: 'Material image',
      displayMode: 'thumbnail',
      size: { width: 240, height: 160 },
    },
    {
      projectId: 'p1',
      artifactId: 'brand-text',
      kind: 'other',
      mimeType: 'text/plain',
      title: 'Brand statement',
    },
    {
      projectId: 'p1',
      artifactId: 'audio',
      kind: 'other',
      mimeType: 'audio/wav',
      title: 'Ambient audio',
    },
  ]);

  assert.deepEqual(created.map((entry) => entry.size), [
    { width: 410, height: 273 },
    { width: 205, height: 127 },
    { width: 385, height: 142 },
    { width: 171, height: 96 },
  ]);
  assert.deepEqual(created.map((entry) => entry.nodeType), ['image', 'image', 'note', 'note']);
});

test('existing binding keeps persisted Huabu geometry instead of reapplying Figma preset', async () => {
  const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
  await bindings.bind({
    projectId: 'p1',
    canvasId: CANVAS,
    spatialKind: 'node',
    spatialId: 'persisted-image',
    entityType: 'artifact',
    entityId: 'image-main',
  });
  let createCount = 0;
  const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
    if (body?.type === 'INSPECT_NODES') {
      return jsonResponse({
        type: 'INSPECT_NODES',
        result: {
          count: 1,
          total: 1,
          truncated: false,
          nodes: [
            {
              id: 'persisted-image',
              type: 'image',
              filename: 'image.json',
              position: { x: 10, y: 20 },
              absolutePosition: { x: 10, y: 20 },
              size: { width: 250, height: 180 },
            },
          ],
        },
      });
    }
    createCount += 1;
    throw new Error(`unexpected create: ${JSON.stringify(body)}`);
  };
  const rfs = new HuabuRfsClient({
    canvasId: CANVAS,
    baseUrl: BASE,
    bearerToken: 'token',
    fetch: fetchMock,
  });
  const projector = new ProjectToSpaceProjection(rfs, bindings);
  const result = await projector.projectArtifacts([
    {
      projectId: 'p1',
      artifactId: 'image-main',
      kind: 'image',
      title: 'Main image',
      displayMode: 'card',
    },
  ]);

  assert.equal(result[0]?.spatialId, 'persisted-image');
  assert.equal(createCount, 0, 'existing node must never be resized/recreated by Figma preset reconciliation');
});

test('ArtifactView selection is scope-aware and stable when view order reverses', () => {
  const views = [
    { id: 'context-view', artifactId: 'a1', scopeId: 'context', referenceKind: 'primary', revisionId: 'rev-context', size: { width: 205, height: 127 }, displayMode: 'thumbnail' },
    { id: 'main-view', artifactId: 'a1', scopeId: 'main', referenceKind: 'primary', revisionId: 'rev-main', size: { width: 410, height: 273 }, displayMode: 'card' },
  ];
  const selected = viewPresentationByArtifact([...views].reverse(), { scopeId: 'main' });
  assert.equal(selected.get('a1')?.viewId, 'main-view');
  assert.equal(selected.get('a1')?.revisionId, 'rev-main');
});

test('MIME joins selected view revision exactly, independent of revision array order', () => {
  const result = mimeTypeByArtifact(
    {
      artifacts: [{ id: 'a1', currentRevisionId: 'rev-audio' }],
      artifactRevisions: [
        { id: 'rev-audio', artifactId: 'a1', fileRecordId: 'file-audio' },
        { id: 'rev-image', artifactId: 'a1', fileRecordId: 'file-image' },
      ],
      fileRecords: [
        { id: 'file-audio', mimeType: 'audio/wav; charset=binary' },
        { id: 'file-image', mimeType: 'image/png' },
      ],
    },
    new Map([['a1', { revisionId: 'rev-image' }]]),
  );
  assert.deepEqual(result.get('a1'), { mimeType: 'image/png', fileRecordId: 'file-image', revisionId: 'rev-image' });
});

test('partial projection retry reuses successful binding and creates only the failed entity', async () => {
  const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
  const nodes = new Map<string, { id: string; label: string }>();
  let createCount = 0;
  let failB = true;
  const fetchMock = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(init.body.toString()) : undefined;
    if (body?.type === 'GET_SPACE_OUTLINE') return jsonResponse({ type: 'GET_SPACE_OUTLINE', result: { version: 1, bbox: null, nodes: [], edges: [], spatial: { clusters: [] } } });
    if (body?.type === 'INSPECT_NODES') {
      const inspected = (body.ids ?? []).flatMap((id: string) => {
        const node = nodes.get(id);
        return node === undefined ? [] : [{ id: node.id, type: 'note', filename: 'note', position: { x: 0, y: 0 }, absolutePosition: { x: 0, y: 0 }, size: { width: 385, height: 142 } }];
      });
      return jsonResponse({ type: 'INSPECT_NODES', result: { count: inspected.length, total: inspected.length, truncated: false, nodes: inspected } });
    }
    const node = body?.commands?.[0]?.nodes?.[0];
    createCount += 1;
    if (node?.data?.label === 'B' && failB) {
      failB = false;
      throw new Error('simulated single-item failure');
    }
    const id = `node-${createCount}`;
    nodes.set(id, { id, label: String(node?.data?.label ?? '') });
    return jsonResponse({ canvasId: CANVAS, runId: `run-${createCount}`, fromVersion: 0, toVersion: createCount, commands: [], results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes: [{ nodeId: id, width: 385, height: 142 }] }], revisions: [], affected: { nodeIds: [id], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: [] } });
  };
  const projector = new ProjectToSpaceProjection(new HuabuRfsClient({ canvasId: CANVAS, baseUrl: BASE, bearerToken: 'token', fetch: fetchMock }), bindings);
  const inputs = [
    { projectId: 'p1', artifactId: 'a', kind: 'text' as const, title: 'A' },
    { projectId: 'p1', artifactId: 'b', kind: 'text' as const, title: 'B' },
  ];
  const first = await projector.projectArtifactsWithReport(inputs);
  assert.deepEqual(first.bindings.map((binding) => binding.entityId), ['a']);
  assert.equal(first.failures.length, 1);
  assert.equal(first.failures[0]?.entityType, 'artifact');
  assert.equal(first.failures[0]?.entityId, 'b');
  assert.match(first.failures[0]?.message ?? '', /simulated single-item failure/);
  const second = await projector.projectArtifacts(inputs);
  assert.deepEqual(second.map((binding) => binding.entityId), ['a', 'b']);
  assert.equal(createCount, 3, 'retry must not recreate successful A');
});
