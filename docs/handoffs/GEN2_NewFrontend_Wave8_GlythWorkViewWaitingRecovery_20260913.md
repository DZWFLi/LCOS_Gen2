# Wave 8 施工交付 — Glyth / Conversation Work View / Waiting / Recovery

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 8

## 用户现在真实能做什么

在 Main 画布上双击任一会话 Glyth 节点（无 binding 的不响应，单击仍是选择），打开该会话的专业工作台：identity/reach 真实投影 + Run 段 + 续工/恢复段。真实数据实测：
- 「受控-主会话」Glyth 打开后显示 **真实 waiting run**（run-2d8d），问题「受控问题：按方案 A 还是 B 继续？」带 A/B 选项与「提交回答」；
- 提交回答 → Core 真实返回 409「controlled bridge answer timed out (injected)」→ UI **如实显示失败并保留输入**（不伪造成功，Run 保持 waiting_input）；
- 「受控-切换会话」与「受控-主会话」显示 **真实续工操作**（op-3 established / op-2 outcome_unknown），步骤与 allowedActions 由 T6 投影提供；点击「核对外部状态」真实执行 → op-2 推进为 `recovering`、external_create `failed`、给出真实原因「No matching external session found; no second create is performed.」，动作列表更新为 recover_external/取消该操作；
- 关闭工作台 → 回原画布（camera 未动）。

## Before → After

- Before（Wave 7）：Glyth 是只读身份卡；Waiting/Recovery 无宿主（archive 的孤立 body 未接入）。
- After：Glyth 带双击打开语义（`GlythNodeBody`，经 seam 的 glyth 分支注入，不进通用物种表以避免循环依赖）；`ConversationWorkViewBody` 挂 ProfessionalWindowStage 的 `conversation` body key；`WaitingInputSection` 挂 run/attention 段；`RecoverySection` 挂续工段。三者都只用真实 Core route（work-view aggregate / input-request / recovery-actions）。

## Production caller

```text
GlythNodeBody（双击）→ useLcosShellStore.openWindow('conversation', title, connectedConversationId)
→ ProfessionalWindowStage → ConversationWorkViewBody
   ├─ ConversationWorkViewController（web-gen2，epoch/generation guard）→ CoreConversationClient.getWorkView / listConnectedConversations
   ├─ run.status === 'waiting_input' → WaitingInputSection → CoreRunClient.getPendingInputRequest / answerInput
   └─ operations → RecoverySection → CoreContinuationClient.executeRecoveryAction（allowedActions 由 T6 投影提供）
```

## 修改文件

- 新增：`lcos/nodes/GlythNodeBody.tsx`、`lcos/professional/{ConversationWorkViewBody,WaitingInputSection,RecoverySection}.tsx`、`scripts/e2e/{wave8-workview,wave8-workview-detail,wave8-answer-recovery}.mjs`。
- 修改：`lcos/nodes/{createLcosNodePresentationSeam（glyth 分支）,LcosSpeciesBodies（导出 LcosSpeciesBodyContent）}`、`lcos/professional/ProfessionalWindowStage.tsx`（conversation body 接入）。

## Donor/Figma 采用

- Figma page 11/12 + T7 本地 16 component sets（P0-07b WaitingInputBody / P0-08 RecoverySectionBody 语义）；未逐实例复制。
- archive `ad15da4` 的「Glyth 双击打开 Work View」机制（B：按 nodeEntityRef 解析 ConnectedConversation.id，无 binding 不响应）；未照搬 archive 的 overlay 挂法。
- web-gen2 `ConversationWorkViewController` / `waiting input` / `continuation` 客户端为 Wave 0 救回的地基（A）。

## 真实数据路径

`GET .../connected-conversations`（5 条）→ 逐条 work-view：`runs`（其中 1 条 waiting_input）、`operations`（op-1/op-2/op-3）→ WaitingInput 读 `GET /runs/run-2d8d/input-request` → 回答 `POST /runs/run-2d8d/input-request`（409 injected timeout，诚实失败）→ Recovery `POST .../conversation-continuations/op-2/recovery-actions`（真实推进为 recovering）。

## 浏览器操作与截图（scripts/e2e/wave8-*.mjs）

| 断言 | 结果 |
|---|---|
| Main 5 个 Glyth body | ✓ |
| 双击 Glyth → 工作台打开（标题「工作台 · 受控-新建会话」） | ✓ wave8_step2 |
| 工作台含 identity/reach/Run/续工段 | ✓ |
| 5 个会话逐个打开：1 个真实 waiting run、2 个真实续工操作 | ✓ wave8_step4 |
| waiting run 显示真实问题 + A/B 选项 + 提交回答 | ✓ |
| 提交回答 → 真实 409 → 如实失败 + 输入保留 | ✓ wave8_step5 |
| 恢复动作「核对外部状态」→ op-2 真实推进 recovering + 「不重复 create」原因 | ✓ wave8_step6 |
| 关闭窗口 → 回画布（canvas 存活） | ✓ wave8_step3 |
| Console：唯一错误 = 真实 409（业务失败，非代码错误） | 记录 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu typecheck | PASS |
| eslint src/lcos（max-warnings 0） | PASS |
| vitest src/lcos + src/lcos-seam（12 文件 / 63 tests） | PASS |
| 浏览器真实交互（回答/恢复动作） | ✓（含真实失败路径） |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- 四类续工语义（continue existing / native fork / selected-context new / blank new）的**发起**入口：T7 provider 需配置 spawn 命令；当前未配置 → 诚实 unavailable（本波只做既有 operation 的恢复与 waiting 回答，不伪造新会话创建）。
- provider capability 门控 UI（provider 不支持时禁用原因）：Wave 9 与 RuntimeDoctor 一起收口。
- capture-inbox / connector-source / runtime-doctor body：占位（Wave 5/8 收尾项，未声称完成）。
- reach「可达项 0」为本环境真实值（无外部会话绑定）。

## 下一 Wave 的直接输入

- Wave 9 就绪：motion/material/responsive/LOD/a11y —— 需要把各 Wave 已有的岛/卡/窗口统一到 reduced-motion、键盘焦点、44px 热区、1440/1366/1024 三档实测与 LOD 阈值校准（`nodePresentation.ts` 的 SCREEN_DENSITY_THRESHOLDS 与 host 侧 zoom 阶梯需要对齐收口）。

## 回滚点

Wave 7 commit 之后；glyth 分支与三个 section 均为独立文件，seam 去掉 glyth 特例、Stage 去掉 conversation case 即回到 Wave 7 形态。恢复动作对本地受控数据 op-2 的状态推进（outcome_unknown → recovering）已记录，属可重跑的开发样本。