# Gate 2–5 — Collaboration 迁移 + R1 合流交接（整批）

> 日期：2026-09-17 · 批次末 HEAD 见 git log（含下述 commits）
> 依据：《Collaboration Runtime × Glyth UX 收敛总施工方案 V1》+ R5 规范（会话 productization）

## 本批 commits

1. `feat(core)` Collaboration read projection（session/timeline 路由 + capability resolver + 7 测试）
2. `feat(web-gen2)` facade V1（readSession/readTimeline/subscribe + command seam，14 测试）
3. `feat(gen2)` Glyth/WorkView/Composer 迁移 + R1 CollaborationTarget merge

## Canonical owners 落位（Gate 3）

| 动作 | owner | 状态 |
|---|---|---|
| delegate | POST /projects/:pid/runs（RuntimeApplication） | 既有，已接 seam |
| answerInput | POST /runs/:id/input-request（同一 Run） | 既有，已接 seam |
| approve（accept/reject） |  POST /artifact-returns/:id/accept|reject（CAS expectedBaseRevisionId 强制） | 既有，已接 seam |
| cancel | POST /runs/:id/cancel（runtimeApplication.cancel） | 既有，已接 seam（facade 新增 cancelRun） |
| recover | POST conversation-continuations/:op/recovery-actions（action 必须来自 allowedActions） | 既有，已接 seam |
| resume | continuation submit（continue_existing） | 既有，已接 seam |
| handoff | POST /receiver-handoff（ReceiverRuntimeService.prepareHandoff 快照冻结） | 既有，已接 seam |
| send | Huabu live send transport | **未接线 → fail-closed（不 fallback createRun）** |
| fork | native full-history fork | **未探测 → fail-closed（selected-context new 不冒充）** |

## Read path（Gate 2）

- Core：`CollaborationProjectionService`（+ resolver + timeline projector）只读聚合，零新增持久化。
- Client：`CoreCollaborationClient.readSession/readTimeline/subscribe`；subscribe 复用既有
  `GET /projects/:pid/events`（ProjectEventHub 唯一事件 owner），内部类型 → 3 产品信号。
- UI：collaboration session store（每 project 共享 SSE、SSE 命中即重取 watched 会话）。

## R1 合流（CollaborationTarget）

- dropTypes 新增 `collaboration-reference`（kind + semantic⑨conversationId + intent）。
- resolver/commitRouter：preview = execute（同一 intent 对象）；owner = composer target +
  draft references（delegate 随 receiverConversationId 送达）；owner 缺席 → fail-close。

## Gate 4 结构性变化

- Glyth：pose 只由 6 用户态驱动（needs_user→attention；working/thinking→active）；未 ready 回退 descriptor。
- Work View：Header → Timeline → inline Waiting/Review → Composer（target=canonical Conversation）→ Context → collapsed Diagnostics。
- provider / externalSessionId / RuntimeDispatch / operation / revision / journal 不进首屏。

## Gate 5 legacy caller census

| file | symbol | 状态 |
|---|---|---|
| `huabu/.../app/lcosCoreClient.ts` | new CoreRunClient 等（通用 typed 工厂，非 Collab 域） | 保留（facade 内部使用，UI 不直连） |
| `huabu/.../professional/ConversationWorkViewBody.tsx` | collaboration.continuations（RecoverySection client） | 经 facade，合规 |
| `huabu/.../professional/WaitingInputSection.tsx` | collaboration.runs.getPendingInputRequest（读取） | 过渡登记：待 projection 覆盖 inputRequest 读到 read 投影层 |
| `huabu/.../professional/ArtifactReturnSection.tsx` | collaboration.runs.listRunReviews / retryArtifactReturn | 过渡登记：review/retry 语义待 canonical 收口（retry 无独立产品命令） |

**Conclusion：Collab UX 域无 UI 直连 Raw Run/Continuation client；无第二 Session SoT；无第二 Event Bus。**

## 测试（本批定向）

- contracts 47（含冻结 8）；local-core projection 7；web-gen2 全套 304（facade 14）；huabu drop 9 + 定向 25
- 全量链见批次收尾。