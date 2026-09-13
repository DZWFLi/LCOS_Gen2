# GEN2 R2 交接 — Main 垂直切片（2026-09-14）

分支 `frontend-reconstruction-v2`（不 push、不合并 main）。
状态：**ready_for_review** —— 按 14 号文档 R2 退出条件，**在此停下等用户第一轮可见验收**。
R3/R4/R5 的源码写入在验收通过前不启动。

---

## 0. 已读清单（SOP 前置阅读）

| # | 材料 | 读到的关键结论 |
|---|---|---|
| 1 | `14_..._保留重写矩阵与Recovery_Waves.md` R2 段 | 9 条施工顺序 + 5 条退出条件 + "在此暂停一次" |
| 2 | `16_R0_Readback复核与下一步指令` | R0 校准两点；R2 前不得重排画布 |
| 3 | `AGENTS.md` / `docs/construction/PROJECT_READBACK.md` | 施工落点纪律；GEN1 是 donor（A/B/C/X）；前端重装硬规则 |
| 4 | `SOURCE_ADOPTION_LEDGER.md` | T1-A03（GEN1 落位纯函数）/ T1-A06（GEN1 nodeCardRegistry）两条 donor 条目 |
| 5 | GEN1 源码（只读 donor） | `apps/web/src/features/canvas/canvasGeometry.ts::{paddedRectsOverlap, placeNewNodesIncrementally}`、`nodeCardRegistry` 机制；本地副本 commit `f084158` |
| 6 | Figma 本地设计包 | `structures/{navigator,railway,window-chrome,feedback}`（R1 已用）、Main 母表 |
| 7 | 实测：隔离环境浏览器 | 见 §3 证据 |

---

## 1. 交付内容（对照 R2 九条施工顺序）

| # | R2 施工项 | 本轮结果 |
|---|---|---|
| 1 | Launcher + ProjectShell + HUD 基础构图 | **已有**（R1 族化完成；Main 的 Shell/HUD/Railway/Dock/Composer 均在生产路由上） |
| 2 | 单一 NodePresentation Junction | **完成**：`createLcosNodePresentationSeam` 是唯一 resolve；唯一消费方 `NoteNode`；`NODE_SPECIES_BODY` 第二张物种表已删除，改为注册进唯一注册表 |
| 3 | renderer registry 成为 production caller | **完成**：`web-gen2 rendererRegistry.ts::createNodeCardRegistry`（GEN1 `nodeCardRegistry` B 级换壳）+ `lcos/nodes/lcosNodeCardRegistry.ts` 注册 12 个物种；junction 只问注册表 |
| 4 | 可达物种（Source/Working/Generated/Context/Run/Decision/Glyth…） | **部分**：source/glyth/run 由 Core 绑定真实可达；**collection/workflow-collection/decision/prompt-frame/context-reference/working/draft 在今天的 Core 图里没有 producer**（投影图只有 artifact/conversation/skill/run）→ 见 §5 缺口 2。`canvasRef→portal` 的兜底被**收窄**为只认纯入口壳，避免未绑定用户节点被顶掉 |
| 5 | 真实内容位（title/secondary line/status…） | **完成（artifact 族）**：`projectedNodeDescriptor.ts` 从 Core 快照派生 kind/可用性/受管/revision → 真实次级行，经 `listNodeBindings()` → reference store → 物种 body。**文本族投影除外**（见 §5 缺口 3） |
| 6 | 新节点 placement 接 GEN1 donor，已有锚点不动 | **完成**：`gen1Placement.ts`（A 级原样搬运 + 类型改名 + provenance）替换 `index*40`；`projectBatch` 只对新项落位、复用既有 binding |
| 7 | T3 Action Arc 覆盖旧节点工具条命令 | **部分**：新增 `LcosActionArc`（右键节点，5 组命令：进入/关系/编辑/视图/未接线）。真实可用：打开（会话工作台/阅读器/入口预览）、引用/取消引用、文本↔笔记转换、删除（未绑定节点）、适合画面；**未接线命令显式标注 GAP**（强调色/尺寸档/文本格式/AI 运行）→ 见 §5 缺口 4 |
| 8 | 退役旧可见壳 | **部分**：`NodeToolbar`/`Controls`/`MiniMap` 在 `chromeMode=lcos` 下已不挂载（e2e 实测 minimap=0 / controls=0）；**`NodeFloatingToolbar` 与 `EdgeStyleToolbar` 本轮不退役**（见 §5 缺口 4 的理由与清单） |
| 9 | Composer 接 receiver/context/reference controller | **已接线**（Wave 5 既有：`LcosComposerHost` 读 `useLcosReferenceStore` 草稿引用 + `createRun`）；本轮未改逻辑，仅随 R1 的 token 化收敛 |

---

## 2. 五项完成凭证

1. **Exact binding**：GEN1 采用有 provenance（owner/repo/path@commit + license 实况：该库无 LICENSE 文件、package.json 无 license 字段）；Figma 侧引用 R1 族表与 `structures/`。落位算法逐行可对照 GEN1 原文（见 `gen1Placement.ts` 头注释）。
2. **Real state**：物种/次级行/命令可用性全部由真实事实推导（Core 绑定 + Core 快照 + Huabu 回执尺寸）。没有任何"为了好看"的假状态；不可达物种不做静默降级。
3. **Fail-fast test**：
   - `apps/web-gen2/test/gen1-placement.test.ts`（6）：新项互不重叠 / 避开既有障碍 / **既有节点绝不被移动** / 确定性 / 原点规则 / 空输入。
   - `apps/web-gen2/test/binding-projection.test.ts`（+4，共 13）：空画布批次用**真实尺寸**判定不重叠；已绑定实体不被重排；**并发投影同一实体只创建一个节点**（StrictMode 双挂载实测缺陷的回归钉）；CREATE 回执解析。
   - `apps/web-gen2/test/projected-node-descriptor.test.ts`（5）：次级行只写真实事实；物种解析；**未绑定用户节点绝不兜底成 LCOS 物种**；注册表单 owner（重复注册抛错）。
   - `huabu/apps/web/src/lcos/navigation/lcosNodeCommands.test.ts`（6）：命令表按真实事实生成；GAP 命令必须显式标注且禁用。
   - 结果：`apps/web-gen2 npm test` → **247/247 通过**；`huabu/apps/web vitest run src/lcos` → **17 files / 96 tests 通过**；两侧 `tsc --noEmit` 与 `eslint --max-warnings 0`（改动面）均 exit 0。
4. **Full viewport evidence**：`scripts/e2e/r2-main-vertical-slice.mjs`（fail-fast harness，1440×900，隔离环境 reset 后的全新数据）三场景 `ok:true`：
   - placement：3 个投影节点真实坐标 (93,192)(740,192)(740,708)、真实尺寸 607×82，**两两不重叠**（旧实现是同点/40px 级联）；
   - junction/chrome/commands：`MiniMap=0`、`Controls=0`、Railway=1；右键节点 → Action Arc 5 组 9 命令，绑定节点的「打开」「引用」**可用**、`delete` 带真实原因禁用、4 条 GAP 命令禁用并标注；Esc 关闭。
   - 截图：`.e2e-data/shots/r2-main-1440.png`、`r2-action-arc-1440.png`（1440×900）。
   - **两种真实缺陷由这轮 e2e 抓出并修掉**：(a) 落位用请求尺寸（280）而 Huabu 按内容定尺寸（607）→ 两节点落同一格；(b) StrictMode 双挂载导致同一 artifact 被投影两次 → 同坐标重复节点。两者都有回归测试。
5. **Honest remainder**：见 §5。

---

## 3. 复跑命令与退出码

```
# 隔离环境（reset 后 run，保证走"新投影落位"路径）
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 down
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset
powershell -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
node scripts/e2e/r2-main-vertical-slice.mjs          # 三场景 ok:true

cd apps/web-gen2 && npm run typecheck && npm test     # 247/247
cd huabu/apps/web && npx tsc -p tsconfig.json --noEmit
cd huabu/apps/web && npx eslint src/lcos --max-warnings 0
cd huabu/apps/web && npx vitest run src/lcos          # 96/96
```

---

## 4. R2 退出条件对照（诚实版）

| 退出条件 | 结果 | 依据 |
|---|---|---|
| Main 1440 与 `main-final.png` 构图/密度/物种层级/材质一致 | **待用户验收** | 截图已给（`r2-main-1440.png`）；机器只能证明"不重叠/壳正确/命令可用"，构图一致性必须人眼看 |
| 不再出现 3 个 280×220 节点以 40px 级联重叠 | **达成** | `index*40` 已从两处删除；单测（真实尺寸不重叠）+ 浏览器实测（3 节点分散） |
| 真实节点在远/中/近 LOD 都有可辨身份 | **部分** | `useLcosDensity`（mark/summary/working/reading）与物种 body 已在；但**投影的文本族节点走 Huabu TextNode**，本轮不显示真实标题（空编辑器占位）→ §5 缺口 3 |
| 所有节点命令由 LCOS Action Arc/菜单/快捷键到达 | **部分** | Action Arc 覆盖 5 组命令；旧工具条"显示/动作"两组（强调色/尺寸/文本格式/AI 运行）仍未接线 → §5 缺口 4 |
| 旧 Huabu 产品 UI 在 LCOS DOM 中不挂载 | **部分** | NodeToolbar/Controls/MiniMap 已不挂载（e2e 实测）；NodeFloatingToolbar/EdgeStyleToolbar 仍在 → §5 缺口 4 |
| 在此暂停一次，请用户做第一轮可见验收 | **已按此执行** | 本文件即验收包 |

---

## 5. 诚实缺口（PARTIAL，不得改写为完成）

1. **落位不避让 HUD 占用矩形**：Composer/Dock 是屏幕空间浮层，落位在世界空间算，因此新节点可能落在 Composer 后面（e2e 首轮就出现"点到的其实是 Composer"）。避让需要 R3 的 `safeRect`/`occupiedRect` 话题；当前 e2e 用 `elementFromPoint` 显式跳过被遮挡节点。
2. **物种可达性受 Core 图限制**：投影图今天只有 artifact/conversation/skill/run，所以 working/draft/collection/workflow-collection/decision/prompt-frame/context-reference 仍无 producer（Warehouse 侧才有 collection/workflow 事实）→ R4/R5。
3. **文本族投影无真实内容位**：markdown/text artifact 投影为 Huabu `text` 节点（TextNode），不经过 junction，界面显示空编辑器占位而非 artifact 标题/次级行。修法需要"把 artifact 内容/标题喂进节点"的产品决定（是否允许在画布上就地编辑 Core 投影），**不是本轮能单方面拍板的**——请在验收时裁定方向。
4. **旧可见壳未退役**：`NodeFloatingToolbar`（类型切换/强调色/尺寸/文本格式/sketch 笔刷/frame 布局/AI 运行/删除）与 `EdgeStyleToolbar`（边线型/线色）在 LCOS 下仍挂载。LCOS Action Arc 只覆盖了其中 5 类命令；**先退役会让用户丢失能力**（换呈现不删逻辑是红线），故本轮不退役，待 R3（窗口/阅读器）与命令接线补齐后一次性切换。
5. **Portal 族生产不可达（R1 记录更正）**：见 `FIGMA_SOURCE_LEDGER.md` §四.6 —— junction 唯一消费方是 NoteNode，`canvasRef` 不会经过它。
6. **R0 既有 gap 未动**：wave1..wave10 旧 e2e 脚本仍未迁移 harness；Huabu 画布持久化具体文件仍未定位；`reset` 偶发句柄占用。
7. **全量 web vitest 有 1 个与本波无关的既有失败**（Milkdown `blockFingerprintParity`），只登记不改。

---

## 6. 请用户验收（只需看一件事）

打开隔离环境 `http://localhost:5273/projects/lcos-gen2-dev/main`（或你自己的 dev 环境），对照 `main-final.png` 看 **Main 的构图/密度/物种层级/材质**，并对 §5 缺口 3 的方向做一次裁定：

- 文本族投影节点：**（A）** 允许画布上就地编辑 → 需要把 Core 内容接进节点；**（B）** 只读投影 → 走 LCOS 物种 body（标题 + 真实次级行，不可编辑）。
