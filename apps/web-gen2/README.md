# LCOS Gen2 · web-gen2

Spatial operating system frontend, rebuilt from scratch on **Huabu** (Spatial Truth)
+ **LCOS Local Core** (Domain Truth). This app is NOT a continuation of the old
`apps/web`.

## Boundary (2026-09-01 裁决补丁 · 方案①)

```text
LCOS Local Core                Huabu Space
Domain Truth  ── projection ──▶ Spatial Truth
   Project                    canvas / space topology
   Artifact                   node geometry (x/y/w/h)
   Revision                   viewport (x/y/zoom)
   Relation (canonical)       frame membership / parentId
   Skill                      edge visual style
   Run / Result               local spatial history / undo-redo
   Search / Retrieval         transient interaction
   Import / Capture
```

- **Core = Domain Truth.** Core exclusively owns Project / Artifact / Revision /
  Conversation identity / Skill / Run / Result / Search / Import / semantic
  Relation / Context / Assembly / provider+runtime / source path / business meta.
- **Huabu = Spatial Truth.** Huabu exclusively owns canvas topology, node geometry,
  viewport, frame membership, edge *existence + visual style*, spatial undo, and all
  transient interaction (selection / hover / marquee / drag / resize).
- **No Core geometry dual-persistence.** x/y / viewport / frame layout are NEVER
  synced back to LCOS Workspace spatial state.

### Relation ≠ Huabu Edge (critical)

Core Relation expresses *business/semantic* truth (references / derived-from /
revises / depends-on / uses / produced-by). Huabu Edge only expresses *how that
relation is displayed on the current canvas*. So:

```text
Core Relation ──projection──▶ Huabu Edge
Huabu connect gesture ──▶ Core createRelation ──▶ Huabu Edge projection
```

A bare Huabu CONNECT never declares a business relation. Pure visual helper edges
may exist only in Huabu.

### Node types are closed (not LCOS ontology)

LCOS does NOT add Huabu node types. It uses existing primitives as mechanical
projection: image→image, pdf→pdf, text/md→text/note, web→web, video→video,
audio→audio, collection→frame (only when a spatial container is needed), and
Conversation/Skill/Run map to the closest base primitive + LCOS renderer/meta.

### The only bridge = ProjectionBinding

```ts
type ProjectionBinding = {
  projectId: string
  canvasId: string
  nodeId: string
  entityType: 'artifact' | 'conversation' | 'skill' | 'run'
  entityId: string
}
```

Resolution prefers Huabu node metadata (frontmatter) for the external ref; falls
back to a minimal Core binding store only when Huabu can't index it. It never
stores geometry.

### RFS is the formal Spatial Port

All spatial read/write goes through:

```text
POST /api/rfs/:canvasId/query
POST /api/rfs/:canvasId/execute
GET  /api/rfs/:canvasId/capabilities
GET  /api/rfs/:canvasId/download/<path>
```

LCOS does not touch Huabu Space persistence internals.

## G0 scope (this commit)

- `backend/client.ts` — thin HttpClient (JSON / error normalization / AbortSignal / typed).
- `spatial/huabuRfsClient.ts` — RFS client (query / execute / capabilities / download / outline).
- `spatial/projectionBinding.ts` — ProjectionBinding registry (idempotent, no geometry).
- `spatial/projectToSpaceProjection.ts` — Core Artifact → Huabu node, idempotent.
- `spatial/relationProjection.ts` — Core Relation ↔ Huabu Edge projection.

G0-A/B/C/D/E adapters are implemented and type-safe. Live RFS + Core connectivity
smoke (both servers running) is the runtime-validation step.

## Discipline

- `App.tsx < 500 lines`, `HuabuWorkspace < 400 lines`, props < 20.
- No second selection store / drag handler / spatial node model / runtime surface mode > 3.
- No pointermove → Core. No self-built provider selection / search ranking.
- No component named Owner / Truth / Projection / SemanticSurface / Coordinator / Orchestrator / Unified*Owner.
