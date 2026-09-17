# R5 Batch B — Collaboration Interface Seal + Golden Path（交接）

> 日期：2026-09-17 · 依据：《LCOS GEN2 下一轮总施工规划》（BatchB_接口统一封口与下一轮总施工规划）
> 性质：接口统一封口批。B5/B6 浏览器物理交互部分受 Playwright Chromium 下载被网络阻断（cdn.playwright.dev 卡 10%）搁置，登记为下一批；代码侧封口全部完成。

## Current HEAD（本批末）
见 git log（含下述 commits）。施工起点 `4301348`。

## B0 — Current Source Freeze（⌛ 已核）

HEAD `4301348` 清洁、无并行线程漂移；施工表核心条目：

| consumer | current owner | desired seam | action |
|---|---|---|---|
| GlythNodeBody | projection（Gate4） | readSession/userState | 已就位，无需改 |
| ConversationWorkViewBody | 原 controller+raw | readSession/readTimeline/readDiagnostics | 本轮完成迁移 |
| WaitingInputSection | runs.getPendingInputRequest | readPendingInput | 本轮完成 |
| ArtifactReturnSection | runs.listRunReviews/.retry | readReviews + approve/retry | 本轮完成 |
| RecoverySection | continuations.executeRecoveryAction | recover + readDiagnostics | 本轮完成 |
| LcosComposerHost | delegate | delegate（intent 明确=委托） | B3 修正文案/意图 |
| Collaboration Session Store | readSession/readTimeline/subscribe | 已就位 | 无需改 |
| Semantic Drop（dropTypes/…） | R1 owner（含 CollaborationTarget） | 保持 | B6 浏览器交互登记 |

## B1 — Facade 真正封口 ✅ commit acc0ecc

- `CoreCollaborationClient.conversations/runs/continuations` → `private`。
- 新增产品 reads：`readPendingInput / readReviews / readDiagnostics`。
- 新增命令：`retry`（语义裁决 = 真实 product command，Review 决定族；契约加
  `CollaborationRetryInputV1` + `CollaborationCommandKindV1.'retry'`）。
- 契约补产品读投影类型：`CollaborationPendingInputV1 / CollaborationReviewV1 / CollaborationDiagnosticsV1`。

## B2 — Attention / Review / Diagnostics 产品投影 ✅ commit aa2cc24

- WaitingInputSection：readPendingInput（同 pendingInputId→run→question/options）。
- ArtifactReturnSection：readReviews（过滤当前会话 runs/returns；accept/reject→approve CAS；
  retry→新命令）；capability 全关时按钮 disabled+reason。
- RecoverySection：动作走 recover（action/expectedRevision 来自 allowedActions）；
  工程状态经 readDiagnostics。
- WorkView：移除 ConversationWorkViewController 与 raw conversations/runs/continuations；
  Diagnostics（identity/reach/operations）一律走 readDiagnostics。

## B3 — Composer Intent 修正 ✅ commit aa2cc24

- Composer 明确为「交给它做（委托新任务）」= delegate（创建 canonical Run）。
- 不再伪装「继续这个会话」；send fail-closed（canSend=false）时 Header 诚实展示 reason。
- send ≠ delegate ≠ resume 心智分离完成。

## B4 — Legacy Caller Retirement ✅ commit c6c1(guard)

- 全仓 census：Collab UX 域零后门（唯一命中为注释；lcosCoreClient 工厂属非 Collab 产品 UI 域，允许保留）。
- 静态 guard：`collaboration/facadeSeal.enforcement.test.ts`（8 用例，扫
  professional/composer/collaboration/nodes，禁 facade raw 访问 + 禁直 new raw client）。

## B5 — Receiver-Seeded Browser Golden Path ⏸ 登记（网络阻断）

- 阻塞：Playwright Chromium headless-shell 下载卡 10%（cdn.playwright.dev 不可达）。
- 已具备：live-stack smoke spec（4301348 已含）+ 本地 smoke 启动命令。
- 恢复后：MVP+receiver seed fixture（POST connected-conversations + set receiver），
  跑 Case A–K（bound Glyth / work view / composer target / delegate / waiting / review /
  recovery / drop→Glyth / reload / multi-Glyth / camera）。

## B6 — R1–R3 Interaction Closure ⏸ 登记（浏览器物理交互搁置）

- R1：基础+CollaborationTarget 已具备；浏览器 pointer→dwell→preview→commit 流程待浏览器；
  external file/text/url：capture/import owner 未接 → 保持 fail-close（规划允许，禁止临时造 owner）。
- R2：安全区/几何/HUD 消费已建；move/resize/dock/group 物理指针交互待浏览器。
- R3：Navigate+CAS reorder 已建；Receive/Reorder durable/stale/management 待浏览器。
- 注：以上全部为非阻塞登记，不涉及架构 owner 重做。

## 测试 / Baseline

- web-gen2 全套 304/304 + tsc 0；contracts dist 重建（esbuild）；huabu build 46.7s 通过。
- huabu 定向：ArtifactReturnSection 3/3（新语义）、drop 9/9、guard 8/8、shell store 绿；
  ProfessionalWindowStage 2 项失败 = 既有基线（react/jsdom act 环境问题，上批对等抽样 19/1 证明）。
- 协议/调用方/Composer 封口 checklist（规划 §12）代码侧全满足；Browser checklist 因网络挂起到下一批。

## 下一批唯一建议入口
1. Playwright Chromium 下载恢复后（或 `E2E_BROWSER_CHANNEL=msedge` 用系统浏览器）：
   `npx playwright test -c e2e/lcos-collab-smoke.playwright.config.ts`（live 栈前置：local-core MVP+fake + vite 5173）
2. 补 receiver-seeded fixture → 跑 Case A–K 黄金路径 → B6 物理交互 closure。