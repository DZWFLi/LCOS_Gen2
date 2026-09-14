# GEN2 T6/T7 Transport & Recovery Handoff（2026-09-14）

- 分支：`frontend-reconstruction-v2`（不 push、不合并 main）
- 范围：非视觉——T6/T7 真实 transport 接线、恢复语义、共享接口账、非视觉测试
- 视觉禁改区：未触碰（`LcosActionArc.tsx` / `LcosSpeciesBodies.tsx` / `GlythNodeBody.tsx` / `ImageNode.tsx` / `AudioNode.tsx` / `NodeWrapper.tsx` / `r2-main-vertical-slice.mjs` / `glythPresentation.ts`）

---

## 1. T7 Exact Census（CURRENT / PARTIAL / FAKE / GAP）

### 1.1 Adapter 方法面（`apps/local-core/src/huabu-agentlet-continuation-adapter.ts`）

| 方法 | 状态 | 说明 |
|---|---|---|
| `probe()` | **CURRENT** | 真实 capability probe；`nativeFullHistoryFork` / `attachContext` / checkout 固定 unknown/hard_gap，不猜 |
| `createSession()` | **CURRENT** | `transport.spawn` → `external_created` |
| `continueExisting()` | **CURRENT** | `transport.spawn({sessionId})` → `resumed` |
| `nativeFork()` | **CURRENT** | 诚实返回 `unsupported` + `degradedFromNativeFork: true`（不冒充 fork） |
| `attachContext()` | **CURRENT** | 诚实返回 `unsupported`（provider 无 attach RPC） |
| `send()` | **CURRENT** | `transport.sendResource` → `sent`（但 T6 无 recovery action 调用，见 GAP-2） |
| `status()` | **CURRENT** | `transport.getSession` → `accepted`/`unresolved`（但 T6 无 recovery action 调用，见 GAP-2） |
| `cancel()` | **CURRENT** | `transport.stop` → `accepted`/`outcome_unknown` |
| `recoverExisting()` | **CURRENT** | lookup miss 固定 `unresolved`，绝不隐式 create |

### 1.2 Transport seam

| Transport | 状态 | 说明 |
|---|---|---|
| `HuabuAgentletGatewayTransportV1` | **CURRENT / REAL** | 真 WS JSON-RPC 到 `HUABU_AGENTLET_GATEWAY_URL`；未配 `spawnCommand` 时诚实失败 |
| `DevFakeAgentletTransportV1` | **FAKE**（dev-only） | 明确标注 MOCK，仅 `LCOS_RECOVERY_TRANSPORT=fake` 时注入；不冒充生产能力 |

### 1.3 T6 Service（`apps/local-core/src/conversation-continuation-service.ts`）

| 能力 | 状态 | 说明 |
|---|---|---|
| `submit()` | **CURRENT** | 幂等：同一 operationId 不重复 create journal |
| `advanceStep()` | **CURRENT** | `external_create` confirmed 必须带 `externalEvidence`（不冒充） |
| `reconcile()` | **CURRENT** | 无证据保持 outcome_unknown（诚实降级） |
| `requestCancel()` | **CURRENT** | 本地意图记账，不冒充终态 |
| `applyProviderCancelReceipt()` | **CURRENT** | cancel 三态：requested / outcome_unknown / confirmed |
| `executeRecoveryAction()` | **CURRENT** | recover_external / recover_bind / retry_attach / reconcile / cancel_request 全接 adapter；retry_projection 抛 unsupported |

### 1.4 四种 Continuation Mode

| Mode | submit | recover 路径 | 状态 |
|---|---|---|---|
| `continue_existing` | ✓ | recover_bind → `continueExisting` | **CURRENT** |
| `native_full_fork` | ✓ | 先 `nativeFork` → unsupported 则 degrade 到 `createSession` + bundle | **本轮新增**（P1） |
| `selected_context` | ✓ | recover_external → `createSession`；attach 步骤 `not_applicable` | **PARTIAL**（attach 无 provider RPC，诚实降级） |
| `blank_new` | ✓ | recover_external → `createSession(blank)` | **CURRENT** |

### 1.5 GAP 清单

| ID | GAP | 影响 | 是否本轮修复 |
|---|---|---|---|
| GAP-1 | `native_full_fork` 无 degrade orchestration | submit 后只能走 create，不试 fork 也不标 degradation | **本轮修复** |
| GAP-2 | `send()` / `status()` 无 T6 recovery action 调用链 | adapter 方法实现但无用户入口 | 未修复（需契约新增 action 或确认走 Run 消息通道） |
| GAP-3 | `selected_context` 的 context attach 不完整 | attach 步骤直接 `not_applicable`，无 first-send degrade | 未修复（provider 无 attach RPC） |
| GAP-4 | 前端 Composer 只发 `mode: 'continue_existing'` | 其他 3 种 mode 无法从 UI 触发 | 未修复（属 UI/交互层，Figma 分支可能涉及） |

---

## 2. 本轮实际修改

### 2.1 `apps/local-core/src/conversation-continuation-service.ts`

`#recoverExternal` 新增 `native_full_fork` degrade 编排：

```
if (row.mode === 'native_full_fork') {
  sourceExternalSessionId = connectedConversation.conversationRef
  if (sourceExternalSessionId !== undefined) {
    forkReceipt = adapter.nativeFork({ sourceExternalSessionId })
    if (forkReceipt.outcome === 'external_created' && nativeFork) → confirmed
    if (forkReceipt.outcome === 'unsupported' && degradedFromNativeFork) {
      createReceipt = adapter.createSession({ createVariant: 'long_lived' })
      if (createReceipt.outcome === 'external_created') → confirmed + errorEvidence 记录降级
    }
  }
  // 无 fork 源 → 直接 create（不冒充 fork）
}
```

新增辅助 `#sourceExternalSessionIdForFork()`：从 `metadata.getConnectedConversation().conversationRef` 取外部 session 稳定引用。

### 2.2 `apps/local-core/tests/continuation-recovery-action.test.ts`

新增 3 个测试：
1. `native_full_fork`：provider 不支持 fork → degrade 到 create + bundle，`errorEvidence` 记录降级
2. `native_full_fork` 无 fork 源（未指定 connectedConversationId）→ 直接 create
3. duplicate submit（同一 operationId）→ 幂等返回 `created: false`

---

## 3. 测试结果

```
apps/local-core tsc --noEmit            exit 0
apps/local-core continuation tests      41 passed (原 38 + 新增 3)
  - conversation-continuation-service   14 passed
  - continuation-recovery-action        13 passed (含新增 3)
  - continuation-provider-contract      14 passed

全量 local-core: 697 passed / 47 failed
  47 failed 均为既有失败（skill/vector/resource/runtime-persistence/execution-gate 等），
  与 continuation 无关。已用 git stash 验证：stash 后 skill-layering.test.ts 仍 8/8 失败。
  按规则不修既有失败。
```

---

## 4. T6 Receipt/Recovery 生产链核验（P2）

| 核验项 | 结果 | 证据 |
|---|---|---|
| externalSessionId 全链路传递 | ✓ | recover_external 存 `externalEvidence`；recover_bind/retry_attach/cancel 从 `row.externalEvidence.externalSessionId` 读 |
| provider 透传 | ✓ | `row.provider` → adapter 调用 → receipt |
| correlation 幂等 | ✓ | `correlationId = operationId`；submit 同 operationId 不重复 create |
| retry receipt | ✓ | submit 幂等返回 `created: false` |
| cancel receipt 三态 | ✓ | requested → outcome_unknown → confirmed |
| timeout → outcome_unknown | ✓ | `classifyHuabuTransportErrorV1`；不自动 retry |
| restart reconciliation | ✓ | `reconcile` action → `adapter.recoverExisting` |
| duplicate submit 同一 operation | ✓ | 测试验证 `created: false` |
| Work View 同一 Core projection | ✓ | `ConversationWorkViewProjectionService` 直接消费 T6 service；`operations` 字段类型为 `ContinuationRecoveryProjectionV1[]`，无本地状态 |

---

## 5. Figma 分支可消费的共享接口账（P4）

### 5.1 Source Descriptor 字段

| 字段 | Producer | exact API / file | 已接通 | 失败语义 |
|---|---|---|---|---|
| `artifactKind` | Core `Artifact.kind` | `projectionFacade.ts:272` | ✓ | undefined → 物种退回 note |
| `mimeType` | Core `FileRecord.mimeType` | `projectionFacade.ts:279-281` | ✓ | undefined → 视觉 family 退回 |
| `sourceKind` | **无 producer**（属 resource/connector 域） | `projectionFacade.ts` 未设置 | ✗ GAP | 始终 undefined → reference/context/web 物种永不触发 |
| `managed` | Core `Artifact.managed` | `projectionFacade.ts:273` | ✓ | undefined → 不显示"受管" |
| `preview` | Core `FileRecord` content 前 N 字符 | `projectionFacade.ts:312-333` `readPreview` | ✓ | 读不到 → 不带字段，body 退回形态说明 |
| `secondaryLine` | 派生（artifactKind/managed/availability） | `projectedNodeDescriptor.ts:77-100` | ✓ | 无事实 → 空串 |
| `fileRecordId` | Core `ArtifactRevision.fileRecordId` | `projectionFacade.ts:248` | ✓ | undefined → 无真实字节出口 |

### 5.2 Conversation Descriptor 字段

| 字段 | Producer | exact API / file | 已接通 |
|---|---|---|---|
| `active` | Core `ConnectedConversation.isRunning` | `projectionFacade.ts:296` | ✓ |
| `waiting` | Core `ConnectedConversation.waitingReason !== null` | `projectionFacade.ts:297` | ✓ |
| `provider` | Core `ConnectedConversation.provider` | `projectionFacade.ts:295` | ✓ |

### 5.3 Media URL 边界

- `stageProjectedSources.ts`：Core 字节 → `uploadImage` → 裸 artifact key → 节点 `data.src`
- **只读 Core、只写 Huabu `data.src`，不做任何 Core 写操作**，不新建 store / 不改 ProjectionBinding
- 画布资产区是呈现副本，可随时由 Core 重建
- **不写回 canonical artifact key**

### 5.4 AI Provenance Badge 语义来源

- `nodeSpecies.ts:74`：`source.sourceRunId !== undefined && source.managed === true` → `'draft'` 物种
- 语义来源 = Core Artifact 的 `sourceRunId` + `managed` 字段（真实事实，非 UI 造）
- 视觉呈现（badge 本身）由 Figma 分支负责

### 5.5 Geometry 边界

- `projectToSpaceProjection.ts:147-149`：已有 binding 的实体**原位不动**（复用既有节点，永不重排用户锚点）
- 只有真正需要新建的实体参与落位（GEN1 `placeNewNodesIncrementally`）
- 新节点 initial geometry 由落位算法决定；已持久化用户 geometry 不被覆盖

---

## 6. 与 Figma 分支可能冲突的文件

| 文件 | 本轮是否修改 | 冲突风险 | 说明 |
|---|---|---|---|
| `apps/local-core/src/conversation-continuation-service.ts` | ✓ 修改 | 无 | 非视觉，Figma 分支不涉及 |
| `apps/local-core/tests/continuation-recovery-action.test.ts` | ✓ 修改 | 无 | 测试文件 |

**未触碰任何 §二 视觉禁改区文件。**

---

## 7. 诚实剩余（未完成）

1. **GAP-2**：`send()` / `status()` 无 T6 recovery action 调用链。adapter 方法完整但无用户入口。需确认是走 Run 正常消息通道还是新增 continuation action。
2. **GAP-3**：`selected_context` 的 context attach 不完整。provider 无 attach RPC → attach 步骤 `not_applicable`。需 provider 侧支持 attach RPC 或实现 first-send degrade。
3. **GAP-4**：前端 Composer 只发 `mode: 'continue_existing'`。其他 3 种 mode 无法从 UI 触发。属交互层，需 UI 配合。
4. **真实 provider 未接通**：`HUABU_AGENTLET_GATEWAY_URL` 未配置时 `recoveryAdapter = undefined` → recovery 动作 503。需真实 gateway + spawn command。
5. **既有测试失败 47 项**（skill/vector/resource/runtime 等）：与本任务无关，未修。

---

## 8. 回滚点

```
git diff --stat
  apps/local-core/src/conversation-continuation-service.ts   | 52 +++++++++++++-
  apps/local-core/tests/continuation-recovery-action.test.ts  | 33 ++++++++
```

回滚：`git checkout apps/local-core/src/conversation-continuation-service.ts apps/local-core/tests/continuation-recovery-action.test.ts`

---

## 9. 下一步建议

1. **Figma 验真通后**：按 Wave 定点读 Main 实现，消费本接口账的字段
2. **GAP-4 修复**：前端 Composer 支持 4 种 mode 选择（交互逻辑，非视觉）
3. **真实 gateway 接线**：配置 `HUABU_AGENTLET_GATEWAY_URL` + `HUABU_AGENTLET_SPAWN_COMMAND`，端到端验证 real transport
4. **GAP-2/3 裁决**：确认 send/status 的调用链归属（Run 通道 vs continuation action）
