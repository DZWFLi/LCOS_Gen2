# LCOS Gen2 · T2 C2-4 Current Source Census Checkpoint

> 日期：2026-09-07  
> 基线：`LCOS_Gen2/main@232b2ca5` + `Huabu@a3c411e1f655191344285141f08c4738fa6015f7`  
> 范围：C2-4A Railway Receive / C2-4B Receiver / C2-4C Navigation More  
> 状态：SOURCE CENSUS COMPLETE / EXACT BLUEPRINTS NEXT / NO PRODUCTION PATCH

## 1. Owner map

| Domain | Canonical owner | Mechanical owner | Visible consumer | 状态 |
|---|---|---|---|---|
| Railway destination eligibility | T6 exact contract | — | T2 Railway | WAIT_T6_EXACT |
| Railway typed drop intent | T3 | T3 drop machine | T2 Railway | WAIT_T3_EXACT |
| physical cross-Space transfer | Huabu | Space Move API/service | current modal/toolbars | KEEP MECHANICS |
| Railway receive presentation | T2 | — | 尚未落地 | ADD |
| Receiver identity/binding | Local Core | ReceiverRuntimeService | 尚无 T2 consumer | KEEP CORE / ADD CLIENT |
| Receiver handoff | Local Core | prepare/read/consume | 尚无 T2 consumer | KEEP CORE / ADD CLIENT |
| Receiver realtime | ProjectEventHub | `continuity.changed` | subscriber 未落地 | KEEP / WAIT SUBSCRIBER |
| Navigation More | 各 feature owner | Huabu DropdownMenu | 尚未落地 | ADD PRESENTATION ONLY |

## 2. C2-4A · Railway Receive

### Current Huabu mechanical chain

```text
NodeFloatingToolbar / MultiSelectToolbar
→ canvasStore.setMoveSelectionDialogOpen(true)
→ MoveSelectionModal
→ api/canvas.moveCanvasSelection()
→ POST /canvas/:canvasId/move-selection
→ moveCanvasSelection()
→ buildSpaceMovePlan()
→ destination + source writes / compensation
→ MoveSelectionResponse
```

Exact files：

```text
huabu/packages/shared/src/types/api/space-move.ts
huabu/apps/web/src/api/_routes.ts
huabu/apps/web/src/api/canvas.ts
huabu/apps/web/src/components/Panels/Canvas/MoveSelectionModal.tsx
huabu/apps/web/src/components/Panels/Canvas/MoveSelectionModal.test.tsx
huabu/apps/server/src/modules/canvas/canvas.route.ts
huabu/apps/server/src/modules/canvas/space-move-plan.ts
huabu/apps/server/src/modules/canvas/space-move-plan.test.ts
huabu/apps/server/src/modules/canvas/space-move.service.ts
huabu/apps/server/src/modules/canvas/space-move.service.test.ts
```

Mechanical capabilities confirmed：

- existing/new destination union；
- expected source version；
- stale/conflict/unknown-outcome errors；
- multiple canvas mutex；
- selected roots + frame descendants；
- internal edge preservation and boundary-edge omission receipt；
- artifact cloning/reference rewrite；
- agent/conversation movement constraints；
- optional source Space preview；
- compensation path；
- destination rename/dedupe receipt。

### LCOS adoption rule

```text
Rail direct drop
→ T3 typed DropDestination
→ T6 canonical eligibility + semantic transaction
→ determine spatial effect
   ├─ source-stay semantic projection: do NOT call Space Move
   └─ physical transfer: call Huabu Space Move adapter
→ consume truthful receipt
→ Railway RECEIVE success/failure presentation
```

`MoveSelectionModal` 不是 Railway 主 UX。可复用 API、service、schema、errors 与 tests，不复用 chooser-first interaction。

Open exact questions（不得由 T2 猜）：

1. T3 最终 `DropDestination` type/path；
2. T6 Railway eligible destination projection；
3. 哪些 canonical action 是 source-stay，哪些需要 physical move；
4. Core transaction 与 Huabu move 的提交/补偿顺序。

## 3. C2-4B · Receiver

### Current Core chain

```text
packages/contracts/src/receiver.ts
→ apps/local-core/src/routes/receiver.ts
→ ReceiverRuntimeService
→ SqliteMetadataRepository
   ├─ connected_conversations
   ├─ project_receiver_bindings
   └─ project_handoff_packs
→ ProjectEventHub
→ continuity.changed
```

Routes confirmed：

```text
connected-conversations list/create/connect/disconnect
receiver-binding get/set active
receiver-handoff prepare
receiver-handoff pending read
receiver-handoff consume
```

Semantics confirmed：

```text
prepare
→ freeze/store snapshot only
→ no send/run side effect

consume
→ mark latest pending pack consumed
→ idempotent boundary
```

Tests already cover service, HTTP, events, persistence/restart and pending consumption in `apps/local-core/tests/receiver-handoff.test.ts` and conversation identity tests.

### Missing T2 consumer

Current `apps/web-gen2/src/backend/` has no Receiver client. Current LCOS Railway UI is also absent. C2-4B therefore needs：

```text
Receiver typed client
Receiver VM/presenter
Rail bottom item
active/working/waiting/disconnected/unavailable states
ProjectEvents invalidation/refetch
explicit switch/handoff flow
```

It must not create：

```text
ReceiverStore as canonical truth
second conversation identity
frontend-generated receiver/session ids
prepare side-effect send
```

## 4. C2-4C · Navigation More

No current LCOS `Navigation More` owner/consumer was found. This is expected: More is low-frequency presentation, not a domain.

Adoption rule：

```text
Huabu DropdownMenu primitive
→ T2 menu body
→ feature-owner callbacks
```

Allowed content：

- manage/reorder Railway entry point；
- explicit create/open Worksite entry point；
- low-frequency Receiver management entry point；
- settings/help actions already owned elsewhere。

Forbidden：

- NavigationMoreStore；
- duplicate Rail order persistence；
- duplicate Worksite creation semantics；
- direct Core mutations hidden in menu item components；
- recreating SurfaceDock/Railway/Receiver inside the menu。

## 5. Integration risks

1. Huabu Space Move is spatial/mechanical; calling it before Core semantic commit can produce spatial success with canonical failure.
2. Calling Core first without a recoverable/compensated Huabu plan can produce canonical success with spatial failure.
3. `MOVE_OUTCOME_UNKNOWN` must enter truthful recovery/waiting state, never optimistic success.
4. Boundary edges are intentionally omitted and reported; LCOS must not silently imply all relations moved.
5. `createSourcePreview` is Huabu Space Preview behavior, not automatically an LCOS Railway/Worksite portal decision.
6. Receiver events are invalidation signals, not a second canonical event-store truth.
7. Current LCOS host extension has no production Canvas consumer at `232b2ca5`; C2-4 visible UI depends on ProjectSession mount restoration.

## 6. Exact blueprint split

```text
C2-4A_RailwayReceive_ExactSourceBlueprint
→ typed intent seam
→ eligibility
→ source-stay vs physical-transfer decision
→ Huabu adapter
→ receipt/error/recovery

C2-4B_Receiver_ExactSourceBlueprint
→ Core client
→ VM/state matrix
→ SSE invalidation
→ Rail bottom presence
→ switch/handoff

C2-4C_NavigationMore_ExactSourceBlueprint
→ menu information architecture
→ callback contract
→ ownership/availability
→ keyboard/accessibility

C2-4_IntegrationCheckpoint
→ owner table
→ transaction ordering
→ browser journeys
→ recovery matrix
```

## 7. Current status

```text
C2-4 source census       COMPLETE
C2-4A blueprint          NEXT
C2-4B blueprint          PENDING
C2-4C blueprint          PENDING
C2-4 integration         PENDING
Production patch         LOCKED
```

