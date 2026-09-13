# FIGMA_SOURCE_LEDGER — 设计→源码采用账本

初始化：2026-09-13。Figma 文件 `nFUdroLvI5qJZuYTW8h2rF`；机器入口 = `deliverables/GEN2_新前端重新总装正本_20260913/references/figma-master/unification/`（nine-surface-status.json、token-style-component-manifest.json、specs/、structures/）。
PNG 只做整页视觉走查；exact node/component/variant、variables/styles、structures/specs、SVG 才是施工输入。

| ID | Figma page/frame/node | component/variant | token/asset | target body | presenter/producer | action owner | fallback | viewport evidence |
|---|---|---|---|---|---|---|---|---|
| FIG-PROJECT | launcher 5388:3652 / spec 5392:3427 | ProjectLauncher family | Theme vars（--lcos-surface-base 等） | `lcos/app/LcosProjectLauncherPage.tsx` | Core `projects.ts` list/create | T6 项目事实 | Core offline / path error 分类提示 | Wave 1 |
| FIG-MAIN | main 5388:96 / spec 5392:3695 | MainWorksite + NodeSpecies | --gen2-canvas/surface/raised/text/muted/border/accent | `lcos/surfaces/main/MainWorksite.tsx` + node bodies | T1/T2/T3/T6 | Huabu kernel | loading/empty/normal/error | Wave 4 |
| FIG-HUD | hud 5388:27696 / spec 5392:7799 | ProjectShell 5386:436；NavigatorIsland 5384:367（11 variants）；Railway 5385:283（2） | Pin violet/teal/amber（--lcos-pin-*）；GLASS S:3438dd... | `lcos/shell/LcosGlobalHud.tsx`、`LcosRailway.tsx`、`navigation/*` | T2 nav/Pin/Railway | T1 camera | Navigator loading/error/degraded 共用壳 + SurfaceFeedback 5391:357 | Wave 4 |
| FIG-CONTEXT | context 5388:21602 / spec 5392:4840 | ContextWorksite + ChildCanvas | 集合手牌 context styles | `lcos/surfaces/context/ContextWorksite.tsx` | T1/ T2/ T6 | Huabu kernel | cold/empty/recovery | Wave 6 |
| FIG-ATLAS | atlas 5388:24294 / spec 5392:4924 | CollectionSurface 5333:96（组织=事情/时间 × 呈现=总览/主画布/装配） | 248×244 体块、列间 32 | `lcos/surfaces/context/ContextAtlasStage.tsx` | T6 成员事实 | T1 集合投影 | 缓存可读 + 标缺失 | Wave 6 |
| FIG-TEMPORAL | temporal 5388:25701 / spec 5392:6043 | TemporalRail（右 24、宽 65、maxH 555） | — | `lcos/surfaces/context/TemporalRail.tsx` | 时间分组 producer | T2 交互/T1 camera | 不画虚假刻度 | Wave 6 |
| FIG-WORKFLOW | workflow 5388:22998 / spec 5392:4882 | WorkflowWorksite + TaskCard 5335:110（7 状态） | 3:4 卡 224×324 | `lcos/surfaces/workflow/WorkflowWorksite.tsx`、`WorkflowCard.tsx` | T6 Run 事实 | T4 work view | 封面失败→任务图标 | Wave 7 |
| FIG-WINDOW | window 5388:27165 / spec 5392:6085 | ProfessionalWindowChrome 5387:331（浮动/停靠/分组） | header 48、min 360×280 | `lcos/professional/ProfessionalWindowStage.tsx` | T4 窗口拓扑 | body 各 owner | 过期目标明确不可用 | Wave 5 |
| FIG-READER | reader 5388:27411 / spec 5392:6127 | ReaderChrome + ArtifactReaderBody | text 16–18、长行自适应 | `lcos/professional/ArtifactReaderBody.tsx` | T6 artifact/revision | T4 + Huabu preview | 无可预览→外部打开 | Wave 5 |
| FIG-PORTAL | 产品 Portal 5348:1151（6 状态） | 目标预览状态 | 440×360 | `lcos/portal/*` | 进入目标 | T2 worksite | 旧缓存/部分预览/缺失 | Wave 6 |

共享组件族（先行）：NavigatorIsland 5384:367、Railway 5385:283、ProjectShell 5386:436、ProfessionalWindowChrome 5387:331、SurfaceFeedback 5391:357；第 13 页集合 5333:96/5334:46、取用任务牌 5335:110、Portal 5348:1151。
语义纠正：ColorPin = 颜色分组偏好及成员关系（00 页 5409:2 纠正，非"持久关系"简写）；Context/Workflow 主稿复用 Main 基础 Shell + 选中态覆盖，component variant 名不代表现场归属。

> 规则：编码任一可见组件前，先从此表（或母表 grep 该 node）找到一行，绑定真实 target/caller/producer/fallback；缺 token/asset 时先核 token-style-component-manifest.json 与 exports 资产目录，禁止截图裁片冒充资产。