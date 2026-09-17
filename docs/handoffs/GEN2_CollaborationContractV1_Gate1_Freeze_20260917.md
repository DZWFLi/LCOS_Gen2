# Gate 1 — Collaboration Contract V1 冻结交接

> 日期：2026-09-17
> 施工线：Collaboration Runtime × Glyth UX 收敛总施工方案 V1（桌面前端冲刺文件夹同名 MD）
> 性质：Gate 1（Contract Freeze）交付。类型冻结后，Track B/C/D/E 方可并行。

## Current HEAD

`968a9f2`（frontend-reconstruction-v2；前一个提交 `53d64c6` = R1-R3 合入）

## Changed files

- `packages/contracts/src/collaboration-contract.ts`（新增）
- `packages/contracts/src/index.ts`（追加 `export * from './collaboration-contract.js'`）
- `packages/contracts/tests/collaboration-contract.test.ts`（新增，8 项冻结测试）

## Changed symbols

新增导出：

- `CollaborationUserStateV1`（6 态：ready/thinking/working/needs_user/done/unavailable）
- `CollaborationCapabilitiesV1` + `CollaborationCapabilityReasonsV1` + `unavailableCollaborationCapabilitiesV1()`（fail-closed 默认值，canOpenDiagnostics 常开）
- `CollaborationSessionProjectionV1` / `CollaborationReturnSummaryV1`
- `CollaborationTimelineItemV1` / `CollaborationTimelineItemKindV1`（11 种，projection 而非 Turn 表）
- `CollaborationProductErrorCodeV1`（8 种）/ `CollaborationProductErrorV1` / `collaborationProductErrorV1()`
- `CollaborationCommandKindV1` + 9 个 Input 类型 + `CollaborationCommandInputV1` 判别联合 + `CollaborationReceiptV1` / `CollaborationCommandResultV1`
- `CollaborationAdapterDescriptorV1`
- `CollaborationSessionEventV1` / `CollaborationSessionEventKindV1`（session.changed / timeline.appended / capability.changed）

## Canonical owners touched

无。本批不触碰任何 Core / Run / Continuation / Provider truth；全部只新增 contracts 类型。

## Contracts consumed

- `provider-capability.ts`：`ContinuationProviderIdV1`、`ProviderContinuationCapabilitySnapshotV1`（Adapter descriptor 包裹它，不复制其字段）
- `conversation-identity.ts`：conversationId 语义锚定 ConnectedConversation 身份链（文档引用，无类型耦合）

## Contracts produced

上述全部 `Collaboration*V1` 类型。冻结纪律写进文件头注释：无第二 Session SoT、capability 诚实（false=隐藏/disabled+原因，禁止 fake fallback）、provider/externalSessionId/RuntimeDispatch 不进产品投影、产品错误与工程错误分层。

## Tests run

- `packages/contracts`：vitest 47/47（含新增冻结 8/8）；tsc 0 错；oxlint 0 警告 0 错
- 下游回归：`apps/web-gen2` tsc 0 错

## Known failures

无本批新增。（存量备忘：huabu 全套测试中 27 文件/133 项失败为基线既有，经 V0 验收回放确认与本线无关。）

## Open risks

1. `send()` 的真实 transport 仍是缺口（Huabu live send 未接，方案 §11.4）——Track B 的核心活；在此之前任何 UI 的 canSend 必须保持 false。
2. Capability Resolver（Core 侧把 ProviderContinuationCapabilitySnapshotV1 折算成产品 capability）尚未实现——Gate 2 前置。
3. `subscribe()` 走哪个既有事件总线未选定（方案 §22 禁止新建第二条总线）——Gate 2 时按 current source 定。

## Next exact step

Gate 2（Read Path Complete）：

1. 在 Core（apps/local-core）新增只读 Collaboration Projection Service + Capability Resolver，产出 `CollaborationSessionProjectionV1`（路由建议：`GET /projects/:pid/collaboration-session?conversationId=...`，以 current source 路由惯例为准）。
2. web-gen2 `CoreCollaborationClient` 增加 `readSession()` 消费该路由（V0 facade 演进为 V1）。
3. Glyth / Work View / Composer 三个 UI caller 改经 readSession 取状态（Track C 并行开工点）。
4. R1 侧确认 drop 契约预留 CollaborationTarget（方案 §15：Drop 到 Glyth = 把对象作为 Reference 交给当前 Conversation）。