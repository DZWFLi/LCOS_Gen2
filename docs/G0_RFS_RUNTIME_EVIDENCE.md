# G0 · Real Huabu RFS Runtime Evidence

> This records the G0.4 real runtime smoke run. Servers/tokens here are
> disposable and local-only; no secrets are committed.

| Field | Value |
| --- | --- |
| Date | 2026-09-01 |
| Huabu upstream SHA | `58339e269b784728d67730c70bfe7792cae2457d` |
| Huabu clone | `E:\OS开发\Huabu` |
| RFS server port | `3001` |
| protocolVersion | `2` |

## Setup

- `pnpm install` (store `E:\pnpm-store`, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`)
- Headless RFS server bootstrap:
  `node --import tsx apps/server/scripts/dev/lcos-rfs-bootstrap.mts`
  (registers Huabu's real `rfsRoutes` on a Fastify server + temp workspace +
  disposable canvas, gated by the same Bearer scheme as `app.ts`).
- Smoke command:
  `node scripts/g0-rfs-smoke.mjs`
  with `HUABU_RFS_URL=http://127.0.0.1:3001/api/rfs/<canvasId>` and `AGENTLET_TOKEN=<token>`.

## Smoke run (disposable node/edge roundtrip)

```
✓ capabilities      protocolVersion=2, queries=5, commands=14
✓ GET_SPACE_OUTLINE  nodes=0
✓ CREATE_NODES A     node-a91c8583-…   (server-assigned nodeId)
✓ INSPECT_NODES A    count=1
✓ SET_NODE_GEOMETRY  applied
✓ INSPECT position   x=120,y=80        (geometry persisted)
✓ CREATE_NODES B     node-30a1c64c-…   (server-assigned nodeId)
✓ CONNECT A→B        edge-2422769e-…   (server-assigned edgeId)
✓ INSPECT_EDGES      edges=1
✓ DISCONNECT         applied
✓ DELETE A/B + cleanup=clean
✓ g0:smoke passed
```

## Conclusion

The `web-gen2` RFS adapter spoke real Huabu protocol v2 end-to-end:
create → inspect → move (geometry) → connect → inspect edge → disconnect →
delete, all against a real running Huabu server with real disk storage, using
server-assigned canonical `nodeId`/`edgeId`, `{type,result}` envelope, and
`results[].applied` acceptance. Cleanup verified clean.

Local Core was NOT a dependency for this RFS-only smoke (per the G0.4 plan).
