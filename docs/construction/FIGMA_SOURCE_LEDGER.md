# FIGMA_SOURCE_LEDGER — 设计→源码采用账本

初始化：2026-09-13。最近更新：2026-09-14（R1：设计系统 → 代码组件族）。
Figma 文件 `nFUdroLvI5qJZuYTW8h2rF`；机器入口 = `deliverables/GEN2_新前端重新总装正本_20260913/references/figma-master/unification/`，本地全设计包 `E:\Codex 项目\OS开发\exports\LCOS_Figma_全设计包_20260913\unification\`（含 `token-style-component-manifest.json`、`specs/`、`structures/`、`svg/`）。

PNG 只做整页视觉走查；exact node/component/variant、variables/styles、structures/specs、SVG 才是施工输入。
读结构包用 `node scripts/figma/describe-structure.mjs <name> [--name <regex>] [--depth N]`（打印 pad/gap/尺寸/圆角/fill/boundVariables）。

---

## 一、R1 共享组件族（本 Wave 的主交付）

| ID | Figma component（nodeId / 变体轴） | 变体（取值 = Figma 原文） | 实测几何（structures/） | 代码 target | production caller | gallery | 生产可达变体 | 未达变体归属 |
|---|---|---|---|---|---|---|---|---|
| FIG-FAM-SHELL | 统一 / ProjectShell `5386:436`｜轴 `现场` | Main / Context / Workflow（1440×900） | 变体框 1440×900 | `lcos/shell/LcosProjectShell.tsx`（根 `data-lcos-family="project-shell"`） | `lcos/app/LcosProjectRoute.tsx` → `/projects/:id/:surface` | `/playground/lcos-families` ProjectShell 段 | Main（生产 Main 路由实测 `data-lcos-variant=main`） | Context/Workflow 同组件同路由，切现场即达 |
| FIG-FAM-NAV | 统一 / NavigatorIsland `5384:367`｜轴 `状态` | 静息 / 彩色标 / 搜索 / hover / pressed / focus / disabled / loading / error / degraded / selected（11） | h48 · pad 6/8 · gap 8 · r999 · 键 36（图标 19）· 输入 210 · Pin 角标 22 r11 → 静息 52、彩色标 184、搜索 402 | `lcos/ui/families/LcosNavigatorIslandView.tsx` + `lcos/navigation/LcosNavigatorIsland.tsx`（Core 搜索接线） | 同上容器：`LcosGlobalHud` → 生产 Main（实测 island 存在） | 11 状态全渲染（e2e 断言唯一取值数 = 11） | 静息 / 搜索 / loading / error / disabled | 彩色标 需 Core Pin/颜色组 producer（T2/T6）；hover/pressed/focus/selected/degraded 由 CSS 与键盘真实触发 |
| FIG-FAM-RAIL | 统一 / Railway `5385:283`｜轴 `目的地` | 1 / 4 | pad 8 · gap 6 · item 36 r10 · r26 → 目的地=1 52×52、=4 52×178；高度随真实 item 数量增长 | `lcos/ui/families/LcosRailwayView.tsx` + `lcos/shell/LcosRailway.tsx` | `LcosGlobalHud`；空 order 不挂空壳，旧种子中的三 root workspace 被过滤 | 目的地 1 与 4 两变体 | 显式 Core `orderedRefs` 的读取与弹性呈现；root Surface 只在底部 Dock | 具体 Worksite 激活、Drop 收编、reorder/CAS、真实 hover preview 仍为 GAP；不得再写“三现场真实切换” |
| FIG-FAM-WIN | 统一 / ProfessionalWindowChrome `5387:331`｜轴 `布局` + TEXT 窗口标题 | 浮动 / 停靠 / 分组（640×48） | h48 · pad 8/24 · gap 8 · 标题 22 行高 · 图标键 32 r999 | `lcos/ui/families/LcosWindowChrome.tsx` | `lcos/professional/ProfessionalWindowStage.tsx`（阅读/Assembly/工作台共用顶栏） | 3 布局 + 标题 + 多窗口 tab | 浮动（生产仅浮动；停靠/分组需 Stage 拓扑动作） | 停靠 / 分组 → R3（Professional/Assembly/Reader） |
| FIG-FAM-FB | 统一 / SurfaceFeedback `5391:357`｜轴 `呈现` | loading / empty / normal / focus / disabled / error / recovery（7） | h38 · pad 10/12 · gap 8 · r16 · 图标 18 | `lcos/ui/LcosSurfaceFeedback.tsx`（族根 `data-lcos-family="surface-feedback"`） | Assembly / Atlas / Workflow 等宿主（loading/empty/error） | 7 呈现全渲染 | loading / empty / error / normal | focus / disabled / recovery 由宿主按需给，不伪造 |
| FIG-FAM-COL | 集合 / 上下文跨视图 `5333:96`（轴 `组织` × `呈现`）+ 工作流跨视图 `5334:46`（轴 `呈现`） | 事情/时间 × 总览/主画布/装配；工作流现场/主画布/装配（248×244） | 变体框 248×244（page 13 未随 structures/ 导出 → 内层细分几何不在本次证据内） | `lcos/ui/families/LcosCollectionSurface.tsx` | `lcos/surfaces/context/ContextAtlasStage.tsx`（体块 248×244、列间 32） | 9 体块（6 + 3） | 总览（组织轴已可达：事情/时间真实切换） | 主画布 / 装配 / 工作流跨视图 → R4 |
| FIG-FAM-CARD | 工作流 / 取用卡 `5335:110`｜轴 `状态` | 静息 / 悬停 / 预览 / 已选目标 / 草稿中 / 不可用 / 键盘焦点（7）（224×324 3:4） | 变体框 224×324（同上，page 13 未导出结构） | `lcos/ui/families/LcosTaskCard.tsx` | `lcos/surfaces/workflow/WorkflowCardPool.tsx` | 7 状态全渲染 | 静息 / 草稿中（真实 draft 引用）/ 不可用（无可引用身份）/ 悬停 / 键盘焦点（:focus-within） | 预览 / 已选目标 → R5（Workflow/Hand/Cards） |
| FIG-FAM-PORTAL | 产品 Portal / 目标预览状态 `5348:1151`｜轴 `状态` | 可预览 / 加载中 / 旧缓存 / 部分预览 / 预览失败 / 目标缺失（6）（440×360） | 变体框 440×360（同上，page 13 未导出结构） | `lcos/ui/families/LcosPortalPreview.tsx` | **gallery** + `lcos/professional/PortalPreviewBody.tsx`（窗口 body，已接入 `LcosProfessionalBodyKey`）+ `lcos/nodes/PortalNodeBody.tsx`（seam 会为原生 `canvasRef` 返回它） | 6 状态全渲染 | ⚠ **生产不可达（R1 记录更正）**：唯一 junction 消费方是 `NoteNode`（nodeType=`note`），原生 Portal 是 `canvasRef` 节点，永远不会向 junction 请求 body；因此 Portal 族目前只有 gallery + 机制就位。 | 生产触发 + 窗口内渲染目标现场 → **R4**（Portal 机械须改为 Huabu `canvasRef` + `SpacePreviewViewport`） |

族根契约：一律带 `data-lcos-family="<kebab>"` + `data-lcos-variant="<Figma 取值原文>"`（导航/铁路等另有 `data-lcos-*` 部件锚点）。变体样式集中在 `lcos/ui/families/lcos-families.css`，只允许引用 token 变量。

## 二、R1 token 映射（Figma variables → CSS custom properties）

- 生成器：`scripts/figma/gen-lcos-tokens.mjs`（唯一输入 = `token-style-component-manifest.json`；`--check` 校验产物是否最新）。
- 产物 1（渲染入口）：`huabu/apps/web/src/lcos/ui/lcos-tokens.css` —— 32 个 variable + 3 个 EFFECT 派生变量。
- 产物 2（映射证据）：`docs/audit/GEN2_R1_token_map_20260914.json` —— 每行的 Figma id / 名称 / collection / 变量名出处 / 双主题值 / 原始 RGBA。
- 命名规则：优先 `codeSyntax.WEB`（`--gen2-*` / `--lcos-pin-*`，作者手写），其次 `manifest.suggestedCssAlias`（`--lcos-*`）；两者都缺即脚本报错退出，禁止手编变量名。
- 取值规则：一律取 `resolvedValuesByMode`（alias 链在浅/深两个 mode 常指向同一 VariableID，只有 resolved 才是各主题真实值）。
- TS 侧：`lcos/ui/lcosTokens.ts` 只导出 `var(...)` 语义引用，不复制同值常量（由 `lcosTokens.test.ts` 断言：出现 hex/rgb 即失败）。

| 分组 | 变量 | 浅色 / 深色（节选） |
|---|---|---|
| 节点场景（Gen2 / 节点场景） | `--gen2-canvas` `--gen2-surface` `--gen2-raised` `--gen2-text` `--gen2-muted` `--gen2-border` `--gen2-accent` | `#FAFAFA`→`#0A0A0A`；`#FFFFFF`→`#1F1F1F`；`#547464`→`#9BC0A8` |
| 主题（Theme / Oreo） | `--lcos-surface-base` `--lcos-color-bg-inverse` `--lcos-color-text-on-inverse` `--lcos-text-primary` `--lcos-color-border-default` `--lcos-color-text-secondary` `--lcos-surface-elevated` `--lcos-color-border-subtle` `--lcos-color-palette-blue-text` `--lcos-color-palette-blue-bg` | `--lcos-color-bg-inverse` `#202020`→`#FCFCFC` |
| 导航颜色（LCOS / 导航颜色） | `--lcos-pin-violet` `#6371DD`、`--lcos-pin-teal` `#238E86`、`--lcos-pin-amber` `#CE824C`（与导航岛 Pin 角标实测 fill 一致） | 与主题无关（单 mode） |
| 圆角 / 间距 | `--lcos-radius-control` 8、`--lcos-radius-card-small` 12、`--lcos-radius-medium` 16、`--lcos-radius-capsule` 999；`--lcos-space-x1/x2/x3/8/12/16/24` | 与主题无关 |
| EFFECT 派生 | `--lcos-glass-blur`（GLASS.radius 4）、`--lcos-glass-shadow`（HUD 双层阴影）、`--lcos-shadow-default`（Shadow/Default） | 与主题无关 |

**LCOS 本地 token（Figma 无对应 variable，登记为 honest remainder）**：`lcos/ui/lcos.css` 的 `:root` —
`--lcos-status-danger`（Figma 统一导出包只覆盖 Blue/Pin 组，没有 danger 语义色）、`--lcos-glass-bg`（= `color-mix(gen2-surface 72%)`，跟随主题）、`--lcos-window-shadow` / `--lcos-window-border`（Figma 的 Shadow/Default 是 4/16 近距投影，不描述浮起窗口）、`lcosTokens.fontSize` 阶梯（无 Figma variable）。

## 三、九面级绑定（Wave 级归属，随各 Wave 更新）

| ID | Figma page/frame/node | component/variant | token/asset | target body | presenter/producer | action owner | fallback | viewport evidence |
|---|---|---|---|---|---|---|---|---|
| FIG-PROJECT | launcher 5388:3652 / spec 5392:3427 | ProjectLauncher family | Theme vars | `lcos/app/LcosProjectLauncherPage.tsx` | Core `projects.ts` list/create | T6 项目事实 | Core offline / path error 分类提示 | Wave 1 |
| FIG-MAIN | main 5388:96 / spec 5392:3695 | MainWorksite + NodeSpecies | --gen2-canvas/surface/raised/text/muted/border/accent | `lcos/surfaces/main/MainWorksite.tsx` + node bodies | T1/T2/T3/T6 | Huabu kernel | loading/empty/normal/error | R2 |
| FIG-HUD | hud 5388:27696 / spec 5392:7799 | ProjectShell 5386:436；NavigatorIsland 5384:367（11）；Railway 5385:283（2） | Pin violet/teal/amber；GLASS S:3438dd… | `lcos/shell/LcosGlobalHud.tsx`、`LcosRailway.tsx`、`navigation/*` | T2 nav/Pin/Railway | T1 camera | Navigator loading/error/degraded 共用壳 + SurfaceFeedback 5391:357 | R1（gallery + 生产 Main 截图） |
| FIG-CONTEXT | context 5388:21602 / spec 5392:4840 | ContextWorksite + ChildCanvas | 集合手牌 context styles | `lcos/surfaces/context/ContextWorksite.tsx` | T1/T2/T6 | Huabu kernel | cold/empty/recovery | R4 |
| FIG-ATLAS | atlas 5388:24294 / spec 5392:4924 | CollectionSurface 5333:96 | 248×244 体块、列间 32 | `lcos/surfaces/context/ContextAtlasStage.tsx` | T6 成员事实 | T1 集合投影 | 缓存可读 + 标缺失 | R1（族）+ R4（深化） |
| FIG-TEMPORAL | temporal 5388:25701 / spec 5392:6043 | TemporalRail（右 24、宽 65、maxH 555） | — | `lcos/surfaces/context/TemporalRail.tsx` | 时间分组 producer | T2 交互/T1 camera | 不画虚假刻度 | R4 |
| FIG-WORKFLOW | workflow 5388:22998 / spec 5392:4882 | WorkflowWorksite + TaskCard 5335:110 | 3:4 卡 224×324 | `lcos/surfaces/workflow/WorkflowWorksite.tsx`、`WorkflowCardPool.tsx` | T6 Run 事实 | T4 work view | 封面失败→任务图标 | R1（族）+ R5（深化） |
| FIG-WINDOW | window 5388:27165 / spec 5392:6085 | ProfessionalWindowChrome 5387:331 | header 48、min 360×280 | `lcos/professional/ProfessionalWindowStage.tsx` | T4 窗口拓扑 | body 各 owner | 过期目标明确不可用 | R1（族）+ R3（拓扑） |
| FIG-READER | reader 5388:27411 / spec 5392:6127 | ReaderChrome + ArtifactReaderBody | text 16–18、长行自适应 | `lcos/professional/ArtifactReaderBody.tsx` | T6 artifact/revision | T4 + Huabu preview | 无可预览→外部打开 | R3 |
| FIG-PORTAL | 产品 Portal 5348:1151（6 状态） | 目标预览状态 | 440×360 | `lcos/professional/PortalPreviewBody.tsx`、`lcos/nodes/PortalNodeBody.tsx` | 进入目标（原生 canvasRef） | T2 worksite | 旧缓存/部分预览/缺失 | R1（族）+ R4（现场渲染） |

语义纠正（沿用）：ColorPin = 颜色分组偏好及成员关系（00 页 5409:2 纠正，非"持久关系"简写）；Context/Workflow 主稿复用 Main 基础 Shell + 选中态覆盖，component variant 名不代表现场归属。

## 四、R1 遗留缺口（诚实登记，不得改写为完成）

1. page 13 的 Collection `5333:96`/`5334:46`、TaskCard `5335:110`、Portal `5348:1151` **未随 `structures/` 导出**，只有变体轴与变体框尺寸 → 内层细分几何未采用 Figma，只采用「轴 + 体块 + 身份」。
2. Pin / 颜色组的 Core producer 不存在（无 pin/color-group 客户端）→ 导航岛「彩色标」在生产不可达。
3. `manifest.limitations` 原样保留：无 Code Connect 生产绑定；窗口 chrome 只规定 header 几何，docking/grouping 运行时仍是 source binding；Navigator loading/error/degraded 共用壳几何，需就近组合反馈原语；**深色值是导出的，但本次人工走查只看过浅色**（R1 已用 e2e 断计算样式变化，未做人工深色走查）。
4. SVG 资产 `svg/5385-212.svg`、`5385-215.svg`、`5385-218.svg`（导航岛 Pin 角标）尚未采用：当前用 lucide `Pin` + 22×22 圆角底近似，未使用 Figma 原生 SVG。
5. `lcos/ui/presets.ts` 为空文件（0 字节），Wave 0 遗留；本 Wave 未使用。
6. **R1 记录更正（2026-09-14 R2 期间发现）**：R1 曾把 Portal 记为"生产入口已打通"。复核后确认 **不成立** —— `resolveNodeBody` 的唯一消费方是 `NoteNode`（`nodeType=note`），原生 Portal 节点是 `canvasRef`，不会经过这个 junction；seam 里 `canvasRef → portal` 的分支只有在"某天有 canvasRef 的 junction 消费方"时才生效。Portal 族的真实生产触发属于 R4。此项按诚实剩余处理，不计入 R1 完成。

## 五、R2 新增：落位 / junction / 真实内容位 / 命令面（详见 `docs/handoffs/GEN2_R2_MainVerticalSlice_20260914.md`）

> 2026-09-14 第二次填报（首轮视觉验收被否决后的返工）。Figma 侧仍以 `references/figma-master/unification/main-final.png`（Main 主稿）与
> `token-style-component-manifest.json` 为对照；T3 侧以 `references/original_route_cards/V6/03_T3_LocalInteraction_ActionArc_Composer_30KB_Planning_Guide.md` 的
> 「selection/node near-field overlay、3 normal / 4 max」为规格。

- 落位：`apps/web-gen2/src/spatial/gen1Placement.ts`（GEN1 `placeNewNodesIncrementally` A 级采用；provenance 在文件头）。
  `ProjectToSpaceProjection.projectBatch` 取代 `index*40` 级联；整批共用 GEN1 格点（`stepX/stepY` = 本批最大请求尺寸 + gap），
  每个节点再用 **Huabu 回执的真实尺寸**进障碍表。同 canvas 批次串行；同 (canvas, 实体) 另加建节点互斥 + 锁内双检
  （修 2026-09-14 实测的孤儿节点竞态）。既有 binding 一律复用 → 用户锚点永不被重排。
- 相机取景：`apps/web-gen2/src/spatial/fitWithInsets.ts`（`fitBoundsWithInsets`，默认 maxZoom 1.25，**刻意不采用 GEN1 的 2.0**）
  + `lcos/navigation/LcosCanvasCommands.tsx`（HUD/Composer/Dock 安全边距 + 首屏一次性取景）。取景尺寸判定必须认 `style` 尺寸：
  Canvas 开了 `onlyRenderVisibleElements`，视口外节点永远没有 `measured`。
- junction：`apps/web-gen2/src/presentation/rendererRegistry.ts::createNodeCardRegistry`（GEN1 `nodeCardRegistry` B 级换壳）
  + `lcos/nodes/lcosNodeCardRegistry.ts`（宿主注册点，唯一注册表）；`createLcosNodePresentationSeam` 是唯一 resolve，
  唯一消费方 `NoteNode`。文本族 Core 投影按用户裁决 B 走 `note` 家族进入 junction（`visualFamily.ts`），不再落成空 `Type…` 编辑器。
- 真实内容位：`apps/web-gen2/src/presentation/projectedNodeDescriptor.ts`（Core kind/availability/managed/revision + **fileRecordId/mimeType/preview**
  → 次级行 + 物种 + 正文预览），经 `listNodeBindings()` → `useLcosReferenceStore.descriptor` 抵达物种 body。
  字节出口用 Core 既有的 `GET /projects/:id/file-records/:fid/content`（`CoreArtifactClient.getFileRecordContent/getFileRecordText`）。
- 图片内容落成：`lcos/nodes/stageProjectedSources.ts` —— Core 字节 → `uploadImage` → Huabu 裸 artifact key → 节点 `data.src`
  （因为 Core 字节出口需要 `Authorization` 头，`<img>` 无法携带；Huabu 资产区才是 `ImageNode` 能渲染的来源）。
- 会话/Glyth：`ReconciliationRunner` 增加承接会话投影（与 artifact 同一条 `projectBatch`/binding/落位路径），
  并在**确实读到会话列表**时才清理会话孤儿。
- 命令面：`lcos/navigation/LcosActionArc.tsx` + `apps/web-gen2/src/interaction/nodeCommandModel.ts`（T3-A02 节点近场；
  3 常规动作 + 更多；**不适用动作不出现**，暂不可用给真实 reason）。旧节点壳的停挂名单 = `lcos-seam/chromeModeSlot.tsx`
  `LCOS_STANDDOWN_TOOLBAR_TYPES`（只含每个旧控件都有 LCOS 替代入口的类型）。
- 边命令面：`lcos/navigation/LcosEdgeArc.tsx`（覆盖旧 `EdgeStyleToolbar` 的线型/线色/方向/粗细/断开）。

> 规则：编码任一可见组件前，先从此表（或母表 grep 该 node）找到一行，绑定真实 target/caller/producer/fallback；缺 token/asset 时先核 `token-style-component-manifest.json` 与 exports 资产目录，禁止截图裁片冒充资产。
