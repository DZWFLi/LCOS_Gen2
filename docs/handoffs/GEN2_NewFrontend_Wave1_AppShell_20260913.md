# Wave 1 施工交付 — Route Composition 与 LCOS App Shell

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 1

## 用户现在真实能做什么

打开应用（`/`）自动进入 LCOS 项目启动页；看到真实 Local Core 项目列表、可搜索、可「新建项目」「打开已有项目」（走真实 POST /projects，回执后才进入）；点项目封面进入 LCOS 项目 Shell——整页只剩 LCOS 身份胶囊 + 真实 Huabu 画布 + 底部三现场切换 Dock；Main/Context/Workflow 真实切换（首进自动建立画布并回写）、刷新与浏览器 Back 后身份/现场保持。

## Before → After

- Before：`/` → `/spaces`（Huabu CanvasListPage）→ `/canvas/:id` → `MainLayout` 旧三栏 + CenterArea 浮动按钮 + 原生节点。
- After：`/` → `/projects`（LCOS 启动页图 5388:3652 布局）→ `/projects/:id/:surface` → LCOS ProjectShell（顶左身份胶囊 + 全屏画布 + 底 24 SurfaceDock）。旧五类 UI caller 不再 mount；Huabu `/spaces`、`/canvas/:id` 保留为 dev mode。

## Production caller

```text
App.tsx router（data router）
→ lcosProjectRoutes() [lcos/app/LcosAppRoutes.tsx]
→ LcosProjectLauncherPage（/projects）
→ LcosProjectRoute（/projects/:projectId/:surface?）
→ LcosProjectShell → LcosWorksiteStage → <Canvas/>
                  → LcosSurfaceDock（switchCanvas / createCanvas+updateWorkspaceCanvasId）
数据：CoreProjectClient（listProjects/createProject/getWorkspaces/updateWorkspaceCanvasId）
     → Local Core /projects 路由 → SqliteMetadataRepository
```

## 修改文件

新增（huabu/apps/web/src/lcos/）：`ui/lcosTokens.ts`、`ui/LcosSurfaceFeedback.tsx`、`app/lcosCoreClient.ts`、`app/useLcosWorksite.ts`、`app/LcosAppRoutes.tsx`、`app/LcosProjectLauncherPage.tsx`、`app/LcosProjectRoute.tsx`、`shell/lcosShellStore.ts`、`shell/LcosProjectShell.tsx`、`shell/LcosWorksiteStage.tsx`、`shell/LcosSurfaceDock.tsx`；`scripts/e2e/wave1-acceptance.mjs`、`wave1-reload-check.mjs`。
修改：`huabu/apps/web/src/App.tsx`（路由合并 + `/` 改 `/projects`）、`apps/web-gen2/src/backend/projects.ts`（createProject/deleteProject typed）、`README.md`（新增产品组合根章节）、`AGENTS.md`（新增前端重装硬规则）。

## Donor/Figma 采用

- Figma `launcher 5388:3652 / spec 5392:3427`：品牌/标题/筛选/新建/搜索/封面卡网格布局。
- Figma `ProfessionalWindowChrome/ProjectShell 5386:436`：身份胶囊 + 底部常驻 Dock 位置语义（Main 变体覆盖选中态）。
- Figma `SurfaceFeedback 5391:357`：启动页 loading/empty/error 原语（7 呈现初版）。
- Figma tokens：token-style-component-manifest（surface/canvas/raised/text/muted/border/accent + radius + 玻璃效果 S:3438dd… 的 CSS 近似）。
- GEN1/Huabu donor：未引入新 UI donor；释放 `createCanvas`（Huabu 命令）+ Core workspaces 机制（archive c40b288 流程）。
- 状态标注保持：launcher/main/hud 均为 `DESIGN_READY（1440 主构图）/ PARTIAL_COMPOSITION / NEEDS_SOURCE_BINDING`。

## 真实数据路径

`/projects` → GET /projects（1 个真实项目 lcos-gen2-dev）→ 点卡片 → GET /projects/:id/workspaces（三工作现场含 canvasId）→ switchCanvas(canvasId) → Huabu /api/canvas/:id 加载真实节点（React Flow 渲染出既有节点内容）。Context 现场首进若缺 canvasId → createCanvas() → PUT workspaces/:id 回写 → switchCanvas（本环境三现场 canvasId 齐备，未见创建路径，Wave 2 用另一项目验证创建路径）。

## 浏览器操作与截图

本地 Chromium（playwright-core headless）驱动 localhost:5173（见 scripts/e2e/wave1-acceptance.mjs / wave1-reload-check.mjs）：

| 步骤 | 结果 |
|---|---|
| `/` 重定向 | → /projects ✓（screen wave1_step1_root_1366.png） |
| 启动页 | LCOS 品牌/项目标题/副标题/新建/打开按钮/真实项目卡「LCOS Gen2 开发工作台」✓（wave1_step2_launcher_1366.png） |
| 点卡片进入 | /projects/lcos-gen2-dev/main + Shell ✓（wave1_step3_shell_1366.png） |
| VOID 旧壳探测 | layerPanel:false previewPanel:false canvasHeader:false floatingControls:[] anyAside:false ✓ |
| 画布 | react-flow 存在 + 真实节点文本可见 ✓ |
| reload | URL/身份胶囊/Dock 激活态/画布保持 ✓（wave1_step6_reload_1366.png） |
| Dock 切 Context | URL→/projects/:id/context + Dock Context 激活 ✓（wave1_step7_context_1366.png） |
| browser Back | 返回 main + Dock Main 激活 ✓ |
| 视口 | 1440×900 / 1024×768 整页（wave1_step4_shell_*、wave1_step5_launcher_*） |

Console：无本批错误。

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu web `npm run typecheck` | PASS |
| `npx eslint src/lcos/{ui,app,shell}` | PASS（import/order 自动修复；未触碰的既有文件 lint 不计） |
| huabu vitest（回归） | 170/171（与 Wave 0 相同的 1 个 Milkdown 环境失败，非本波引入） |
| web-gen2 typecheck | PASS（新增 createProject/deleteProject） |
| 浏览器验收脚本 | 全部断言通过（见上表） |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- Global HUD / Railway / Navigator / Locator：Wave 4；HUD 区域当前只有 Dock 的 Navigator 占位图标（未接线，标注 Wave 4）。
- Assembly 入口：Wave 5，当前禁用并标注 GAP。
- Professional Stage / Reader / Composer region：Wave 5，当前为空槽位（不渲染死按钮）。
- 画布左下 Controls/MiniMap/「React Flow」attribution：Huabu Canvas 自带 chrome；LCOS mode 隐藏属 Wave 2 收口项。
- 启动页空状态完整组合（Figma minimumGap）：已有真实数据，未构造空态截图；对话框交互（新建/打开）已实现但未在本环境真实验收（Local Core 与权限边界）。

## 下一 Wave 的直接输入

- Wave 2 材料就绪：Canvas 已以 `chromeMode` 概念挂入 LCOS route；读 `Canvas.tsx` 的 toolbar/Controls/MiniMap 挂点做 chrome 显隐 + `useLcosCanvasProps`/runtime 单实例接入 Shell（projectId 真实化）；回收 locator/seam；旧壳五类 UI caller 的 DOM 探测测试固化为回归脚本。
- 挂载上下文：`Canvas.tsx` NodeBodyResolverContext.Provider 已就位（resolveNodeBody seam），Wave 2 把 runtime.seam.resolveNodeBody 接上。

## 回滚点

`dbd5027`（Wave 0）之后。路由切换通过 App.tsx 一处 diff 回滚；旧壳仍是经 `/spaces`、`/canvas/:id` 可见的独立 dev mode，未与 LCOS 树同时挂 production。
