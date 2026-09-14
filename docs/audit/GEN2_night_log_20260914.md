# GEN2 夜间施工日志（2026-09-14）

规则：每 60–90 分钟追加一条；不含普通确认问题；硬阻塞单独标注。允许的提交都在本分支本地，不 push。

---

## 01:20 条目 1 — R0-A/R0-5 完成，R0-6/R0-3 待做

**HEAD / Git**
- `685e02a` → 新增 `d249395`（R0-5 harness）
- 工作区：`M huabu/apps/web/src/lcos/shell/LcosProjectShell.tsx`（ensureCanvas 候选修复，按 16 号要求保持独立、暂不提交）+ `?? docs/audit/`

**已完成**
1. **R0-A 撤掉 TextNode 临时特例**：反向撤销 21 行（import / BodyOverride 声明 / JSX 分支），`TextNode.tsx` 回到 HEAD 内容（`git diff --quiet` 通过）。冻结证据与 SHA256 保留在 `GEN2_R0_未提交Diff冻结证据_20260914.md`。
2. **R0-5 fail-fast harness**：
   - `scripts/e2e/_harness.mjs`：`requireSelector` / `requireTrue` / `requireEqual` / `requireNonEmpty` / console+pageerror 收集 / HTTP 白名单 / 顶层 catch 置 `process.exitCode = 1`。
   - `scripts/e2e/r0-harness-selftest.mjs` 反证三例：

     | 模式 | 预期 | 实测 |
     |---|---|---|
     | `ok`（真实页面 + 真实选择器） | exit 0 | **exit 0**，`failures/consoleErrors/pageErrors/http` 全空 |
     | `missing`（不存在的选择器） | exit 1 | **exit 1**，`requireSelector 失败：未出现 [data-lcos-selftest-missing-selector]（1500ms）` |
     | `error`（注入 console error） | exit 1 | **exit 1**，`出现 console error：[e2e-selftest] injected console error` |

   - 发现并修掉 harness 自身一个缺陷：`requireNonEmpty` 对 number 取 `.length` 恒 0，导致 ok 场景误报失败——已改为按 number/string/array 分派（这条也是"自检真会失败"的正向证明）。

**三路只读 Scout（已完成第一轮，状态 scouting / 未 reviewed）**

| Scout | 输出 | 关键硬发现（详见 packet） |
|---|---|---|
| R3-professional-scout | `parallel-prep/R3_Professional_WorkPacket.md`（55,864 B） | `AssemblyBody.tsx:88` 对所有 item 写死 `{kind:'artifactView'}` → 投放必然 "Artifact view not found."，而后端 `assembly-apply-service.ts:92-186` 早已按 kind 支持（纯前端接错）；Reader 缺 file-record content client；Window 是静态单窗且与 Dock/Composer `z-40` 重叠 |
| R4-context-scout | `parallel-prep/R4_Context_Portal_Atlas_Temporal_WorkPacket.md`（65,678 B） | 前端无 presentation 持久化 client → "各现场各存 presentation + reload 恢复"不可达；Collection/Portal 物种永不可达（seam 只映射 4 类 entityType）；**Rhine motion donor 源码不存在**（仅合同文本）→ 不得写"采用 Rhine donor" |
| R5-workflow-scout | `parallel-prep/R5_Workflow_Hand_Cards_WorkPacket.md`（51,141 B） | 「打开（尚未接入）」是 `<span>` 非按钮；取用写 `entityType: item.kind`('workflow') 被 `composerController.ts:240` 与 Core `runs.ts:182` 双重静默剔除 → **引用 100% 丢失**；Workflow scope 无 producer |

三路均核验未改动仓库（`git status` 与本条目开始时一致），未启动服务，未提交。

**R0 剩余（下一步顺序，按 16 号 §2）**
1. **R0-6 隔离 fixture/profile**：需先确认 Core 的 DB/端口 env 旋钮与 Huabu `HUABU_DATA_DIR`；Vite 侧 `/lcos-core` 目标 `http://127.0.0.1:43121` 目前**硬编码**（`huabu/apps/web/vite.config.ts`），需改为可配（`VITE_API_PROXY_TARGET` 已支持 Huabu server，Core 侧需新增）。禁止触碰 `apps/local-core/.data/phase2.sqlite` 与 `huabu/apps/server/data/`。
2. **R0-3 ensureCanvas(recreate)**：在可信 harness+fixture 上跑 8 步验收（stale → recreate → persist → reload → 再进不重复创建），单独提交，只含参数透传 + 聚焦测试 + handoff。
3. R0 文档切片提交（audit/handoff），然后确认 R0 退出条件全绿。

**未开始**：R1（设计系统 → 组件族）、R2（Main 垂直切片）。R2 完成后停止写源码并等用户第一次视觉验收。

**硬阻塞**：无。

---

## 02:05 条目 2 — R0 全部退出条件达成（R0 = reviewed），准备进入 R1

**HEAD / Git**：`685e02a` → `d249395` → `c93bce6` → `88f6838` → `323094a` → `3b06e7f`；工作区**干净**（`git status --porcelain` 为空）。

**本轮完成**
1. **R0-A**：撤掉 TextNode 临时特例（回到 HEAD），冻结证据保留。
2. **R0-5**：harness 三例反证成立（ok=0 / missing=1 / console-error=1），并支持"场景前提型 console error 白名单"（摘要仍全量打印）。
3. **R0-6**：隔离 e2e profile 落地（Core 43131 / Huabu server 3011 / web 5273，数据全在 `.e2e-data/`）。**空目录可重建已实测**：`reset` 删除目录后 `up` 重新种入同一 fixture（`lcos-gen2-dev` + `canvas-lcos-main/context/workflow`）。
4. **R0-3**：`ensureCanvas(recreate)` 独立提交；stale → recreate → persist → reload → 再进不重复创建 **全链 exit 0**。

**过程中发现并修掉的真实缺陷/坑（都留了证据）**
- `LcosProjectShell` 零参闭包吞掉 `recreate` → Main 恢复按钮点了没反应（真缺陷，已修）；
- Core 写请求 Origin 白名单默认只含 5173 → 隔离端口写入 403（新增 `LOCAL_CORE_ALLOWED_ORIGINS`，默认行为不变）；
- Vite `/lcos-core` 目标硬编码 43121 → 隔离环境会打到用户 dev Core（改为 `VITE_LCOS_CORE_TARGET`）；
- 空 `HUABU_DATA_DIR` 必须配 `HUABU_WORKSPACE`，否则 app 被重定向到 `/setup` 首启向导；
- PowerShell 5.1 按 ANSI 解析 `.ps1` → 脚本内含中文会解析失败（改为 ASCII-only）；
- `.ps1` 用 `Select-Object -Last` 会缓冲输出，导致"看起来卡住"（改用文件重定向读取）。

**测试与退出码**
```text
node scripts/e2e/r0-harness-selftest.mjs ok      → 0
node scripts/e2e/r0-harness-selftest.mjs missing → 1
node scripts/e2e/r0-harness-selftest.mjs error   → 1
node scripts/e2e/r0-stale-canvas.mjs             → 0（空目录重建后再次 0）
huabu typecheck / local-core tsc                  → 0 / 0
```

**R0 退出条件**：8 项全绿（明细见 `GEN2_parallel_status.json` 的 `R0.exitConditions`）。
**状态**：R0 = `reviewed`（依 16 号文档预授权自动进入 R1）。三路 Scout = `scouting`（packet 已落盘，未 reviewed）。

**R1 计划（接下来做）**
1. 读 `token-style-component-manifest.json` 全量，建立"现有 token/CSS 变量 ↔ Figma alias"对照表；
2. CSS custom properties 作为渲染入口，TS token 只导语义引用（禁止复制同值常量）；
3. 先做共享组件族：ProjectShell / NavigatorIsland / Railway / ProfessionalWindowChrome / SurfaceFeedback / Collection / TaskCard / Portal；
4. dev-only component gallery（覆盖 variant 与 disabled/loading/error/degraded/selected/focus/reduced-motion）；
5. 回填 `FIGMA_SOURCE_LEDGER.md`（node/component/variant/token/asset → code target → production caller）。

**硬阻塞**：无。隔离环境保持运行（43131/3011/5273），用户 dev 栈（43121/3001/5173）未受影响。

---

## 03:05 条目 3 — R1（设计系统 → 代码组件族）就绪，进入 R2

**HEAD / Git**
- R0 后 HEAD `1118c29`；R1 全部改动尚未提交（本条目之后按 16 号文档提交办法落一个本地 commit）
- 改动面：32 个已跟踪文件（其中 25 个是 `.light/.dark` 机械替换）＋ 10 个新增（families/、dev/、lcos-tokens.css、PortalNodeBody/PortalPreviewBody、token map、generator、describe-structure、r1 e2e、R1 handoff）

**已完成**
1. **token 层**：`scripts/figma/gen-lcos-tokens.mjs` 从 Figma manifest 生成 `lcos-tokens.css`（32 变量：17 双主题 + 15 与主题无关；外加 3 个 EFFECT 派生变量）+ `docs/audit/GEN2_R1_token_map_20260914.json` 映射证据。变量名只取 `codeSyntax.WEB` 或 manifest `suggestedCssAlias`（缺失即报错，不手编）；值一律取 `resolvedValuesByMode`（alias 链在浅/深 mode 常指向同一 VariableID，只有 resolved 是真值）。`--check` exit 0。
2. **TS 语义层**：`lcosTokens.ts` 改为只导出 `var(...)`；25 个文件 232 处 `lcosTokens.color.X.light|.dark` 一次性 codemod 去掉主题分叉（脚本用完即删）；LCOS 本地 token（danger/glass-bg/window-shadow/window-border/字号）显式登记在 `lcos.css`。
3. **八族落地**：新增 `lcos/ui/families/`（NavigatorIslandView / RailwayView / WindowChrome / CollectionSurface / TaskCard / PortalPreview）；SurfaceFeedback 与 ProjectShell 原地升级为族。逐族接回生产 caller，无第二套近似件。
4. **实测几何替代猜测**（`scripts/figma/describe-structure.mjs` 读 structures）：导航岛 h48·pad6/8·gap8·r999 → 静息 52、彩色标 184、搜索 402；铁路 pad8·gap6·item36 → 1=52、4=178；窗口顶栏 h48·pad8/24；反馈 h38·pad10/12·r16。为守住 Figma 的 INSIDE 描边外框，导航岛/铁路用 padding-1px + 1px 描边（外框与 Figma 完全一致，e2e 有像素断言）。
5. **两处真实缺陷顺带修掉**：Railway 把 `+N` 脚注塞在岛内 → 撑高外框超出 Figma（改为同级）；Atlas 体块 minHeight 150 + gap16 与 Figma 248×244/列间32 不符（改为族）。
6. **Portal 生产入口打通**：原生 `canvasRef` 节点（真实 `data.targetCanvasId`）→ portal 物种 body（双击）→ 专业窗口 `portal-preview` body → `LcosPortalPreview`。顺带回答 R4 Scout 的「Collection/Portal 物种永不可达」：**Portal 侧已可达**（原生节点即 producer），Collection 侧仍不可达（需 entityType 绑定）。
7. **dev-only gallery**：`/playground/lcos-families`（`import.meta.env.DEV` 分支，不进生产包），八族全部 variant + 浅/深主题切换。

**测试与退出码**
- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `npx eslint src/lcos src/App.tsx --max-warnings 0` → exit 0
- `npx vitest run src/lcos` → 16 files / **90 tests 全绿**（新增 3 个测试文件 / 23 条）
- `node scripts/e2e/r1-families-gallery.mjs` → 两场景 `ok:true`（gallery 变体计数 + 精确像素几何 + 双主题计算样式变化 + reduced-motion 动画取消；生产 Main 族属性实测）
- 截图：`.e2e-data/shots/r1-gallery-light.png` / `r1-gallery-dark.png` / `r1-production-main-1440.png`
- 全量 `vitest run`（177 files）：**1 个与本 Wave 无关的既有失败** `src/components/Milkdown/__tests__/blockFingerprintParity.test.ts`（该文件未被本 Wave 改动，单独跑亦确定性失败）→ 只登记不改

**GAP / PARTIAL（不得改写为完成）**
1. page 13 四组组件（Collection 5333:96/5334:46、TaskCard 5335:110、Portal 5348:1151）未随 `structures/` 导出 → 内层细分几何未采用 Figma，只采用「轴 + 体块 + 身份」。
2. Pin/颜色组无 Core producer → 导航岛「彩色标」生产不可达。
3. 深色模式只有 e2e 计算样式断言，未做人工走眼走查。
4. Figma 原生 Pin SVG（5385-212/215/218）未采用，暂用 lucide 近似。
5. 未达变体归属：WindowChrome 停靠/分组→R3；Collection 主画布/装配/工作流跨视图、Portal 加载中/旧缓存/部分预览/预览失败→R4；TaskCard 预览/已选目标→R5。

**下一步**：进入 R2 Main 垂直切片（Launcher+Shell+HUD → 单一 NodePresentation Junction → renderer registry 成为 production caller → 可达物种 → 真实内容位 → GEN1 placement → T3 Action Arc → 退役旧可见壳 → Composer 接 receiver）。**R2 完成后停下等用户第一次视觉验收，验收前不启动 R3/R4/R5 源码写入。**

---

## 04:10 条目 4 — R2 Main 垂直切片就绪，停在用户视觉验收点

**HEAD / Git**
- R1 提交 `6cdfc93` 之后本轮改动尚未提交（本条目之后提交一个本地 commit）
- 改动面：apps/web-gen2（落位/描述/注册表/门面）+ huabu/apps/web（junction/注册表/物种 body/Action Arc）+ scripts/e2e/r2-* + 文档

**已完成（对照 R2 九条施工顺序）**
1. **GEN1 落位采用**：`apps/web-gen2/src/spatial/gen1Placement.ts`（A 级原样搬运 `placeNewNodesIncrementally` + `paddedRectsOverlap`，provenance 写进文件头）；`ProjectToSpaceProjection.projectBatch` 取代 `projectArtifacts` / `projectionFacade.projectConversations` 两处 `index*40` 级联；已有 binding 复用 → 用户锚点永不被重排。
2. **单一 junction**：删除第二张物种表 `NODE_SPECIES_BODY`，改为注册进 `lcosNodeCardRegistry`（宿主唯一注册点）；机制来自 GEN1 `nodeCardRegistry`（B 级换壳，放进 `web-gen2 rendererRegistry.ts::createNodeCardRegistry`，框架无关）；seam 只问注册表，未注册/未知一律诚实回退 native。
3. **真实内容位**：新增 `projectedNodeDescriptor.ts`（Core kind/availability/managed/revision → 真实次级行 + 物种解析），经 `Gen2Host.listNodeBindings()` 的 `descriptor` 进入 `useLcosReferenceStore`，由物种 body 渲染。
4. **T3 Action Arc**：`LcosActionArc`（右键节点）+ 纯函数 `buildLcosNodeCommands`，5 组命令；真实可用：打开（会话工作台/阅读器/入口预览）、引用/取消引用、文本↔笔记、删除（未绑定）、适合画面；未接线 4 项显式标 `尚未接线（GAP）` 并禁用。

**测试与退出码**
- `apps/web-gen2`: typecheck exit 0；`npm test` **247/247**（新增 6 + 4 + 5 条）
- `huabu/apps/web`: tsc exit 0；eslint（改动面）exit 0；`vitest run src/lcos` **17 files / 96 tests**
- `node scripts/e2e/r2-main-vertical-slice.mjs`（隔离环境 reset 后全新数据）三场景 **ok:true**
  - placement：3 节点 (93,192)(740,192)(740,708) 真实尺寸 607×82，两两不重叠
  - junction/chrome/commands：MiniMap=0 / Controls=0 / Railway=1；Action Arc 5 组 9 命令；绑定节点「打开」「引用」可用；Esc 关闭
- 截图：`.e2e-data/shots/r2-main-1440.png`、`r2-action-arc-1440.png`

**本轮 e2e 抓出的两个真实缺陷（都已修 + 加回归测试）**
1. 落位用**请求尺寸**（280×220）判定格点，而 Huabu 会按内容重新定尺寸（实测 607×82）→ 两个新节点落在同一格。改为"建一个 → 读回真实尺寸 → 作为下一个障碍"。
2. 开发模式 StrictMode 双挂载 runtime → 两次 reconcile 并发读到同一份空 outline → 同一个 artifact 被投影成两个同坐标节点。改为同 canvas 投影批次串行（`PROJECTION_QUEUE`），并加回归测试。

**GAP / PARTIAL（不得改写为完成）**
1. 落位不避让 HUD 占用矩形（Composer/Dock 是屏幕空间浮层）→ R3 safeRect 话题。
2. 物种可达性受 Core 图限制：working/draft/collection/workflow-collection/decision/prompt-frame/context-reference 仍无 producer。
3. **文本族投影无真实内容位**：markdown/text artifact 走 Huabu TextNode（不经 junction），显示空编辑器占位 → 需要用户裁定"画布上是否允许就地编辑 Core 投影"。
4. **旧可见壳未退役**：NodeFloatingToolbar / EdgeStyleToolbar 仍挂载（Action Arc 只覆盖 5 类命令；先退役=删能力，触红线），待 R3 与命令接线补齐后一次性切换。
5. **R1 记录更正**：Portal 族"生产入口已打通"不成立（junction 唯一消费方是 NoteNode，canvasRef 不经过它）→ 已在 FIGMA_SOURCE_LEDGER §四.6 更正，归属 R4。

**下一步（硬停）**：按 14 号文档"在此暂停一次，请用户做第一轮可见验收"。R3/R4/R5 的**源码写入**在验收通过前不启动；三个只读 Scout 的 Work Packet 与 R2 期间新发现（Portal 不可达、落位与 HUD 冲突、物种 producer 缺口）已回填状态文件。

---

## 条目 5（2026-09-14）— R2 返工：首轮视觉验收被否决后的 6 条返工

**触发**：用户《R2 首次视觉验收不通过与返工指令》（审计 HEAD `56d97b0`，R2 保持 PARTIAL）。
6 条否决：① 217% 只见 `Type…`/`AI`/边标签；② 真实标题/次级信息/缩略图/身份未进主视觉；③ 构图极空、与 HUD/Composer/Dock 无内容密度与空间层级；④ Action Arc 实为右侧长方形菜单；⑤ 菜单仍堆「尚未接线（GAP）」；⑥ 旧 Huabu 可见壳仍挂载。
裁决：文本节点方向取 **B —— Core 投影默认只读**（`Core 投影 → LCOS species body → 标题 + 真实次级行 + preview/status → 打开/编辑进 Reader 或 Professional Work View`）。

**本轮做掉的**
1. **文本族与真实内容 routing**：`visualFamily.ts` 的 `text → note`（junction 唯一消费方是 `NoteNode`），首屏不再出现空 `Type…` 编辑器占位。
2. **descriptor 真实内容位**：新增 `fileRecordId` / `preview`；`buildContentPreview` 从 Core FileRecord 正文派生真实预览（按 revision 缓存、体积有界）；会话次级行 = `provider · 运行态`。
3. **图片真实内容**：新增 `stageProjectedSources` —— Core 字节出口需要 `Authorization`，`<img>` 无法携带，因此走「取字节 → `uploadImage` 落进 Huabu 资产区 → 写节点 `data.src`」，图片节点不再显示「无图片来源」。
4. **Main 相机与构图**：整批共用 GEN1 格点（不再逐节点各算步长）；取景用 `fitBoundsWithInsets` + HUD 安全矩形，并**在内容补齐期内跟随取景、补齐后永久交还相机**（因为 RFS 服务端写不会在本会话内增量进浏览器 store，且视口外节点永不渲染）。
5. **Action Arc 回到正确形态**：锚在选中节点近场（`CanvasFloatingPopover`），3 常规动作 + 更多；**不适用动作不出现**；暂不可用给真实 reason；**面板内零 GAP 文案**。
6. **旧壳退役边界修正**：停挂名单收窄为「每个旧控件都有 LCOS 替代入口」的类型（note/image/video/audio/canvasRef/nodeRef）；`pdf`/`office`/`web` 因「下载」「打开外链」无替代入口而**故意继续挂旧壳**（不删能力）。
7. **会话/Glyth 可达**：reconciler 增加承接会话投影（同一条 `projectBatch`/binding/落位），孤儿清理只在真读到会话列表时执行。
8. **fixture 增强**：真实渐变 PNG ×2（512×320）、按 displayMode 分档尺寸（card 360×260 / thumbnail 240×160 / compact 220×96）、relation 5 条，全部带 `e2e fixture` 标识。

**本轮 e2e 又抓出并修掉的真实缺陷（4 个）**
1. `DISCONNECT_EDGES` 断一条**不存在**的边 → 整批 `not-found` 失败 → 重载画布时 reconcile 整体失败。改为先查存在性再断，且 stale 分支不再去断已消失的边。
2. 同批输入含重复实体 → 会建两个节点。批次内按 `entityType:entityId` 去重。
3. **刚建好的节点被误判 stale**：RFS 写回执早于查询可见性 → `findLiveNode` 解绑活节点并重建，产生永不被绑定的孤儿（实测画布 8 节点 / 7 绑定）。改为解绑前隔一拍复核一次。
4. 首屏取景死锁：`onlyRenderVisibleElements` 下视口外节点没有 `measured`，而取景闸门只认 `measured` → 永远等不到；改为认 `style` 尺寸（引擎建节点时已写入真实尺寸）。

**验证**
- `apps/web-gen2`: typecheck exit 0；`npm test` **267/267**
- `huabu/apps/web`: tsc exit 0；eslint `src/lcos src/lcos-seam` exit 0；`vitest run src/lcos src/lcos-seam` **17 files / 93 tests**
- `node scripts/e2e/r2-main-vertical-slice.mjs`（隔离环境 reset 后）：四场景 `ok:true`、exit 0
  - 首屏 `scale≈0.81`、`count=7`、`textNodes=0`、物种含 `source` + `glyth`、真实图片 `naturalWidth=512` ×2、真实正文预览 ×4、节点两两不重叠
  - Action Arc：近场几何（水平相交、垂直 gap ≤ 80）、`primary=3`、`more=1`、`legacyToolbars=0`、面板分组 编辑/外观/空间、**零 GAP**
- 证据：`.e2e-data/shots/r2-main-1440-v2.png`、`r2-action-arc-1440-v2.png`

**仍未解决（PARTIAL）**：run/process 无 provider 来源；portal/collection/workflow-collection/prompt-frame/working/draft 无 producer；pdf/office/web 旧壳未退役；pdf/video/audio 内容落成未接线（Core 也没有 audio/video ArtifactKind）；落位不避让 HUD 占用矩形（R3）；画布 store 同步滞后属 Huabu 内核；孤儿节点竞态已修三处但需继续观察。

**状态**：handoff 只写 `ready_for_review`；`56d97b0` **不是** `R2_ACCEPTED_COMMIT`，本轮新 commit 同样不是 —— 等用户第二次视觉复核。R3/R4/R5 源码写入仍未启动。
