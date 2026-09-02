# Huabu Upstream Reference

LCOS Gen2 talks to **Huabu** through its Remote File System (RFS) port. This
file pins exactly which upstream commit the LCOS Gen2 RFS contract mirrors.

| Field | Value |
| --- | --- |
| Repo | [microsoft/Huabu](https://github.com/microsoft/Huabu) |
| **Vendored path (construction host)** | `huabu/` — inside THIS repo |
| Standalone clone | `E:\OS开发\Huabu` — retired as construction host; kept read-only as the upstream sync reference |
| **Pin commit SHA** | `58339e269b784728d67730c70bfe7792cae2457d` |
| Protocol version | `2` |
| Server default port | `3001` |
| Node requirement | `>=22.22.0` |
| Package manager | `pnpm@10.34.3` |

## Vendoring (2026-09-02)

The Huabu tree is vendored into this repository at `huabu/` via
`git archive` from the standalone clone's HEAD, i.e. upstream pin
`58339e2` plus the three LCOS thin-seam commits already authored there
(`407ea21` shared-type widening, `12d5ba4` Phase A01 host seam,
`129bf81` Phase A02 presentation context) — they are carried into the
vendor drop, not re-authored. Cross-repo TS/Vite aliases
(`../../../LCOS_GEN2/...`) were rewritten to in-repo paths
(`../../../...` from `huabu/apps/web`). `.npmrc` keeps the upstream
portable version (no machine-local store path is committed). The standalone
clone stays untouched for future upstream diffs/syncs; ALL construction
now happens on `huabu/` in this repo and is reviewed in THIS repo's PRs.

## Contract sources

The LCOS Gen2 `web-gen2` RFS transport surface (`apps/web-gen2/src/spatial`)
mirrors these upstream files at the pinned SHA:

- `packages/shared/src/types/api/space-operations.ts`
  - `agentNodeDataSchema` / `agentNodeCreateInputSchema` (create input)
  - `nodeSizeSchema` (position/size, `height: number | 'auto'`)
  - `edgeStyleSchema` (agent-facing edge style, **no** `labelSource`)
  - `agentCanvasCommandSchema` (command union)
- `packages/shared/src/types/canvas/node.ts`
  - `CANVAS_NODE_TYPES` / `AGENT_CREATABLE_NODE_TYPES` (closed unions)
- `packages/shared/src/types/canvas/index.ts` (re-exports)

## RFS reachback surface (server)

- Auth: `Authorization: Bearer <tok>` where `tok === HUABU_CONNECTION_TOKEN`
  (see `apps/server/src/connection-token.ts`). If the env var is unset, a fresh
  256-bit hex token is minted per boot.
- Base: `http://127.0.0.1:<port>/api/rfs/<canvasId>`
- Endpoints used by G0 smoke:
  - `GET  /:canvasId/capabilities` — `getRfsCapabilities()`
  - `POST /:canvasId/query` — `spaceQuerySchema` → `executeSpaceQuery`
  - `POST /:canvasId/execute` — `rfsExecuteRequestSchema` → `executeRfsCommands`
  - `GET  /:canvasId/skill` — canvas access guide
- Routes registered in `apps/server/src/app.ts` under prefix `/api/rfs`
  (module `apps/server/src/modules/remote_fs/rfs.route.ts`).

## Propagation rule

`HUABU_PROTOCOL_VERSION = 2` is asserted at startup (`HuabuRfsClient.assertProtocol`).
Any upstream change that bumps the protocol version, or alters a query/command
schema, must be re-pinned here and mirrored in `web-gen2` before the G0 close
gate is considered met.
