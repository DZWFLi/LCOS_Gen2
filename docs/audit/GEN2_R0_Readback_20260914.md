# R0 Readback（返工纠偏）— 施工方自述

日期：2026-09-14　分支：`frontend-reconstruction-v2`　HEAD：`685e02a`（不 push、不改 main）
已读：`13_…裁决.md`、`14_…Recovery_Waves.md`、`15_…纠偏续工提示词.md`、`00_START_HERE.md`（当日增量）、`05_证据账本与失败样本.md`、`09_T1-T7现成轮子承接补丁卡.md`（T1/T2/T3/T4 相关行）、`12_Figma九面视觉统一与前端协作合同.md`、本仓两本账（SOURCE / FIGMA）+ 九面主稿 PNG 清单。
证据冻结见同目录 `GEN2_R0_未提交Diff冻结证据_20260914.md`。

---

## 1. 为什么 `685e02a` 是 Foundation Snapshot，不是完整前端候选

四条硬伤，每条都有可复查证据：

1. **可见层仍是 Huabu 壳 + LCOS 占位**：`LcosSpeciesBodies.tsx` 只按 `entityType` 粗分（artifact→source、conversation→glyth），真实 artifact kind/mime/role/status/preview 不可达；`TemporalRail` 自述"时间分组尚未接入"；`ArtifactReaderBody` 自述"正文预览尚未接入"；`ProfessionalWindowStage` 是固定右侧单窗（`width: min(520px, …)`）。这些不是视觉打磨问题，是能力未落地。
2. **账本不同意"完成"**：`SOURCE_ADOPTION_LEDGER.md` 中 GEN1 相机/落位纯函数、node registry、Portal/Surface、Railway、Project Search、Locator、`commandDraft`、Professional Window、artifact viewer registry、Glyth motion、Voice 仍为 `PLANNED`；`FIGMA_SOURCE_LEDGER.md` 仍是初始十行，九面全部 `NEEDS_SOURCE_BINDING`。按 12 号合同，"看过 PNG"不等于"采用"，没有 import/移植函数/目标 caller 就不能算复用。
3. **旧命令壳未退**：`NodeFloatingToolbar`（W/H、强调色、打开大视图、移动到 Space）在 LCOS 下仍挂载——我在 Wave 9/10 两次登记为 GAP 却继续往下铺九面，属于顺序错误（F1/F6）。
4. **验收链不成立**：e2e 恒退出 0（见 §5），截图被同一错误画面覆盖（审计报告 SHA256 相同），因此"脚本跑到末尾"被我写成了 PASS。这是把"执行完"当"通过"。

结论：`685e02a` 保留为可选择性救援的 Foundation Snapshot，可见产品层按 R1–R6 重建。

## 2. 两处未提交 Diff 的处置

| 文件 | 处置 | 理由 |
|---|---|---|
| `lcos/shell/LcosProjectShell.tsx`（透传 `recreate`） | **保持未提交，作为独立候选修复**，单独立项验收：workspace 存无效 canvasId → 页面出恢复入口 → 点"重新建立" → Huabu `createCanvas` 成功 → Core `workspace.canvasId` 更新 → 同现场挂新 canvas → reload 后继续用新 canvasId。不得与节点渲染/自动布局/数据重置混在同一提交 | 它修的是真缺陷：`MainWorksiteProps.ensureCanvas` 形参是 `(recreate?: boolean)`，Shell 传零参闭包 → `force` 恒 `undefined` → `ensureSurfaceCanvas` 命中 `if (!force && existing) return existing` 直接返回失效 id，按钮无反应（Context/Workflow 直传故只有 Main 坏） |
| `components/Nodes/text/TextNode.tsx`（补 `BodyOverride`） | **冻结为证据，不作为最终设计，不提交**；其价值只是证明"投影到 text 节点的实体读不到 LCOS 物种 body" | 见 §3 |

## 3. 为什么不能继续逐个 native node type 打 `BodyOverride` 补丁

- 现状是"一个 native body 一套 LCOS 接口"：`NoteNode` 已有一份，text 现在补第二份，后面还有 Image / PDF / Web / Video / Office / Frame 等；接口重复 N 份，漏接一次就复发一次（F2/F3）。
- 正确接管点只有一个：`NodeWrapper` / 统一 NodePresentation Junction 读 `ProjectionBinding + Core descriptor` → `rendererRegistry`（T1-A06）选 LCOS 物种 body → **无 binding 时诚实回退 Huabu native body**。解析只执行一次，native body 只是 fallback。
- 我方判断：**junction 的实现归 R2**（14 号 R2 第 2 条"单一 NodePresentation Junction"、第 3 条"renderer registry 成为 production caller"）。R0 阶段只做：冻结证据、不提交特例、把设计口径写死为"NodeWrapper 单点解析"。若审计要求 R0 就落实现，我按指示提前。

## 4. `(index * 40, index * 40)` 为什么会重叠并把 fit 推到 348%

- 投影默认尺寸 `DEFAULT_SIZE = 280×220`，而机械级联步长只有 40px → 相邻两节点各自重叠约 240×180，3 个以上就整体糊成一团（本会话实测 6 个 `react-flow__node-text` 全部挤在 (0,0)~(200,200)）。
- 相机"适合画面"要把**全部节点**塞进视口：节点箱体极小（约 480×420 世界像素），1440×900 视口按比例算出的 fit 放大倍数就是 ~3.1–3.5 倍（实测 348%），于是标题被放大到不可读。所以 348% 不是相机 bug，是"落位算法缺失"的外显。
- 正确做法（14 号 R0/R2）：新投影接 GEN1 `placeNewNodesIncrementally` 经 Gen2 薄适配放置；已有用户锚点默认不动；自动整理先预览后确认；dev 演示画布用显式 reseed。**禁止**为了截图好看静默重排已持久化画布。

## 5. 当前 e2e 为什么 `mainWorksite=false` 仍会"跑完"

硬证据：

```text
Select-String -Path 'scripts\e2e\*.mjs' -Pattern 'process.exit|throw new Error'
→ 0 命中
```

即 10 个脚本只有 `console.log(JSON)`，**没有任何失败退出路径**。关键 selector 缺失（`waitForSelector(...).catch(()=>{})`）、关键 boolean 为 false、console error、关键实体为空、HTTP 404/409，全部不影响退出码（恒 0）。因此"跑到了末尾"在证据上等价于"什么都没断言"，`staleCanvasEntry.recoverButtonPresent=false` 这种真实失败也被同一份输出掩盖。

关于审计抓到的 `ReferenceError: BodyOverride is not defined`：**根因是我自己的半应用编辑窗口**——我先加了 JSX 里的 `<BodyOverride …>`，几分钟后才补上 `const BodyOverride = useResolvedNodeBody(...)` 声明；审计正好落在这个窗口里。fresh 进程复测（R0-2，见附录）无该错误。但这条错误同时暴露了上一条：一个会让组件抛异常的错误，在脚本里只表现为一行 console 噪音。

## 6. 哪些保留、哪些重写（对齐 14 号矩阵）

**KEEP**：contracts / continuation journal / receipt；Local Core project·workspace·run·recovery routes；web-gen2 Core clients 与 `Gen2Host`（只修 DTO/source-kind/caller 映射）；Huabu Canvas/ReactFlow/viewport/selection/geometry/history（唯一 spatial runtime）；`WaitingInputSection`/`RecoverySection` 的逻辑与宿主位置；e2e 脚本（作为脚手架保留，但必须加失败判定）。

**KEEP + REWIRE**：route-level Shell 与 `CanvasHostBoundary`（修 stale canvas 恢复、统一运行环境）；`ProjectionBinding` → 唯一 NodePresentation Junction；`projectToSpaceProjection` 的 40px 级联 → 接 GEN1 placement；`rendererRegistry` → 成为 production caller；HUD/Railway/Navigator/SurfaceDock 的 query/action controller；Composer 的 `createRun` 路径与 `commandDraft`/receiver 接线。

**REBUILD VISIBLE LAYER**：`LcosSpeciesBodies`（按物种拆组件、消费真实 kind/mime/role/status/preview）；Glyth body（identity/activity/LOD/motion）；Launcher（Figma ProjectLauncher 组件族）；ProfessionalWindowStage（浮动/停靠/分组/safeRect/Esc 栈）；Assembly（source kind + 缩略图/瀑布流/回执）；Reader（viewer registry + 真实 preview capability）；Context/Atlas/Temporal 机械与可见层；Workflow/CardPool（集合节点、Hand、3:4 任务卡、Step/Run/Waiting/Review）。

**RETIRE AFTER REPLACEMENT**：`NodeFloatingToolbar`、`EdgeStyleToolbar` 等旧可见壳——先由 T3 Action Arc 覆盖命令，再在 `chromeMode="lcos"` 下不挂载；保留 selection/resize/edge/history/camera kernel。

## 7. R0–R6 顺序与两个人眼检查点

```text
R0 运行时真相：证据冻结 / 三服务同 checkout / fresh 复测 / ensureCanvas 独立验收 / e2e fail-fast / reseed 说明
R1 Figma design system → 代码组件族 + dev-only gallery + FIGMA_SOURCE_LEDGER 回填
R2 Main 垂直切片：Launcher+Shell+HUD 构图 → 单一 NodePresentation Junction → registry 成为 caller →
   可达物种（Source/Working/Generated/Context/Run/Decision/Glyth）→ 真实内容位 → GEN1 placement →
   T3 Action Arc 覆盖旧工具条 → 退役旧壳 → Composer 接 receiver/reference
        ★ 检查点 1：暂停，用户验 Main（对齐 main-final.png）
R3 Professional Window / Assembly / Reader
R4 Context / Portal / Atlas / Temporal
R5 Workflow / Hand / Cards
        ★ 检查点 2：暂停，用户验 Context + Workflow
R6 整机收口：Pin/Locator/Railway reorder·Receive、motion+reduced-motion、390/768/1440、LOD 四档、
   真实 provider → waiting → result → review → Artifact Return Accept/Retry、reload/offline/stale/timeout/cancel/reconcile
```

除这两个检查点外不逐步请示；每个 Wave 的唯一凭证按 14 号末表五项（Exact binding / Real state / Fail-fast test / Full viewport evidence / Honest remainder），缺一即 PARTIAL。

---

## 附录 A：R0 运行环境证据（已执行）

| port | pid | 服务 | 启动方式 | cwd | 数据落点 |
|---|---|---|---|---|---|
| 43121 | 40592 | Local Core | 仓库根 `npm run dev:local-core` | `apps/local-core`（dist 运行） | `apps/local-core/.data/phase2.sqlite`（+wal，活跃写入） |
| 3001 | 32108 | Huabu server | `huabu` 下 `pnpm dev`（`scripts/dev.mjs`） | `huabu/apps/server` | `huabu/apps/server/data/`（`storage/disk` + `logs/server.log`；**画布持久化的具体文件尚待 R0-3 精确定位**） |
| 5173 | 44784 | Vite (web) | 同上 | `huabu/apps/web` | 无状态 |

画布存储实测：server 重启后仍列出 6 张画布（含重启前创建的 `canvas-4bcac717`；另有 32 节点 `canvas-ac7b8268`、12 节点 `canvas-c69913a7`）。**但 Core 预置的 `workspace-real-main.canvasId = canvas-lcos-main` 不在该列表中** → 首次进入必然 404，只能走"重新建立现场画布"。

## 附录 B：R0-2 fresh 进程复测（已执行）

停掉旧的 Core+Vite，重新启动后（新 pid 见附录 A）用全新 headless Chromium 打开 `/projects/lcos-gen2-dev/main`：

```json
{ "mainWorksite": true, "canvas": true, "domNodes": 6, "species": 3,
  "surfaceActive": "main", "errs": [] }
```

`errs` 含 console error 与 pageerror，均为 0 → 当前工作树下 `BodyOverride is not defined` 不复现（它是半应用编辑窗口的产物，见 §5）。

## 附录 C：R0 完成度（PARTIAL）

| R0 项 | 状态 |
|---|---|
| 1 证据冻结 + 三服务 PID/cwd/port/db | 已做（证据 01 + 本文件附录 A） |
| 2 fresh 进程复测 `BodyOverride` | 已做（附录 B） |
| 3 `ensureCanvas(recreate)` 独立候选修复 | **未完成**：隔离与单项验收路径（含 reload 持久化）待执行 |
| 4 统一 junction | **未完成**：口径已定（NodeWrapper 单点），实现归 R2；TextNode 特例不提交 |
| 5 e2e fail-fast（关键值 false / console error / 404 / 空实体 → 非零退出） | **未完成**：尚未改 harness |
| 6 开发数据 reseed | **未完成**：仓库内**不存在**任何 `lcos-gen2-dev` seed 脚本（全仓仅 e2e 脚本与 handoff 提到该 id）；当前 demo DB 属不可复现历史数据，不得写入验收前提 |

R0 未全部满足，故**不进入 R1**，继续在原地修 R0-3/4/5/6。
