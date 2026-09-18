# HUABU_RETIREMENT_LEDGER — 旧壳退役与内核保留账本

> 2026-09-15 审计提示：历史行中 `command preserved=yes` 只可作为待复核声明，不证明LCOS生产入口已可达。PreviewWorkspace、CanvasHeader、CenterArea、NodeToolbar、EdgeStyleToolbar等必须补当前新入口/caller和行为证据；不得以隐藏旧UI作为迁移验收。新增核对入口见 `../audit/GEN2_UX框架总图与全旅程补漏_20260915.md`。
>
> **2026-09-19 Wave 1 实测（干净 e2e 数据目录，`scripts/e2e/wave1-acceptance.mjs` `ok:true`，`consoleErrors: []`，`failedResponses: []`）**：
> 环境 = `r0-e2e-env.ps1 reset && up`（Core :43131 / web :5273，播种真实项目 `lcos-gen2-dev`）。
> 覆盖：`/spaces` 渲染 LCOS 启动页（1 张真实 Core 项目卡、0 个旧 `/canvas/*` 链接）→ 真实点击进入项目 →
> LCOS Shell 且 **旧壳四类 DOM 标记全为 0**（`[data-right-panel-content]` / `[data-canvas-restoring]` /
> `[data-right-panel-motion]` / CenterArea 浮动组）→ 没有画布时走真实建立路径（`createCanvas` + 回写 workspace）
> → `canvas-9f89…` 上 `.react-flow` 唯一一份 → `/canvas/<真实 canvasId>` 深链进 LCOS Shell 且 **URL 不被改写** →
> 刷新保 project identity 与 Canvas → Context surface 往返 back/forward Shell 不消失 → 1366/1440/1024 三视口整页截图。
> 源码组合树 gate：`apps/web/src/lcos/app/lcosProjectRoutes.routeComposition.test.ts`（5 用例）。
> 行为 gate：`apps/web/src/pages/CanvasPage/CanvasPage.test.tsx`（5 用例）、`lcos/app/useLcosCanvasBinding.test.tsx`（2 用例，含 StrictMode 证伪）。

初始化：2026-09-13。依据 `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md` 结论标签。
标签：KEEP KERNEL（保留机械与 owner）；KEEP COMMAND-HIDE UI（命令保留、UI 不挂）；REPLACE（新 route/视觉接管）；FALLBACK（仅明确失败）；DEV-ONLY。

| old UI / symbol | current caller | 标签 | 新 seam/动作 | production mounted? | command preserved? | evidence |
|---|---|---|---|---|---|---|
| `App.tsx::RootLayout/App` router | main.tsx root | REPLACE(路由组合)/KEEP KERNEL(URL/loader/guard) | `/spaces`→`LcosProjectLauncherPage`（路由由 `lcos/app/LcosAppRoutes.tsx` 持有）；`/projects/:projectId/:surface?`→`LcosProjectRoute`；`/canvas/:canvasId`→`CanvasPage`（LCOS 入口） | element 已换；App.tsx 路由表不再注册 `/spaces` | yes | Wave 1 ✓ 组合树 + 浏览器 |
| `CanvasPage.tsx::CanvasPage` | App `/canvas/:canvasId` | REPLACE(返回树)/KEEP KERNEL(一次性 intent + 画布注意力) | `useLcosCanvasBinding` 解析 canonical 归属（只走 Core `listProjects`+`getWorkspaces`，不猜）→ 交给唯一 `LcosProjectRoute` | 不再返回 `MainLayout`，不再 import 五件 | yes（`newCanvasPlacement` / `previewNode` intent 保留并消费） | Wave 1 ✓ 5/5 单测 + 深链浏览器 |
| `lcos/app/useLcosCanvasBinding.ts` | `CanvasPage` | 新增（canonical 解析） | canvasId→项目+工作现场；查不到返回 `unbound` 诚实面 | 唯一 | n/a | Wave 1 ✓ 2/2（StrictMode 证伪：重引 ref 守卫 → 两条用例失败并报 `{ kind: 'resolving' }`） |
| `MainLayout.tsx::MainLayout` | 无生产 caller（仅 `MainLayout.test.tsx`） | REPLACE | 宽度/resize 数学保留作迁移参考；production 不 mount | no | n/a | Wave 1 ✓ 浏览器 DOM 断言 |
| `CanvasHeader.tsx::CanvasHeader` | 无生产 caller | REPLACE(KEEP COMMAND-HIDE UI) | 菜单动作迁 LCOS Entry Chrome（见下方未完成项） | no | yes（实现保留） | Wave 1 ✓ |
| `CanvasLayerPanel::CanvasLayerPanel` | 无生产 caller | REPLACE | `buildTreeItems`/search/focus 抽 helper → Navigator/Context instruments | no | yes | Wave 1（无 caller）；Wave 4 接命令 |
| `PreviewWorkspacePanel` | 无生产 caller | REPLACE | preview target/tab/session/Escape 复用 → Reader/Work View | no | yes | Wave 1（无 caller）；Wave 5 接命令 |
| `CenterArea.tsx::CenterArea` | 无生产 caller | REPLACE | `LcosWorksiteStage` 直接挂 `CanvasHostBoundary`；Handbook/Settings/Bot 动作由 LCOS 入口接管 | no | yes | Wave 1 ✓ 浏览器 DOM 断言 |
| 画布 load/switch owner | `LcosWorksiteStage`（`switchCanvas`） | KEEP KERNEL（单一 owner） | LCOS 舞台持有；`CanvasPage` 不再调用 `loadCanvas/switchCanvas` | 唯一 | yes | Wave 1 ✓ `LcosWorksiteStage.test.tsx` |
| canvas SSE 订阅 owner | `useLcosCanvasProps` | KEEP KERNEL（单一 owner） | `connect/disconnect(canvasId)`；`CanvasPage` 不再订阅 | 唯一 | yes | Wave 1 ✓ `useLcosCanvasProps.project.test.tsx` |
| Cmd/Ctrl+F 搜索 | `LcosNavigatorIsland` | KEEP COMMAND-HIDE UI → REPLACE | Huabu `useGlobalSearchHotkey`（左栏搜索输入）随旧壳退役；LCOS Navigator 搜索接管同一快捷键 | 旧 hook 不再挂载 | yes（替换实现） | R6-5 / Wave 1 ✓ |
| `Canvas.tsx` | `CanvasHostBoundary` | KEEP KERNEL | 唯一 ReactFlow；`chromeMode="lcos"` 隐藏 NodeToolbar/Controls/MiniMap | yes（唯一一份） | yes | Wave 2 ✓；Wave 1 浏览器复核 `.react-flow` 唯一 |
| `NodeToolbar (CanvasToolbar.tsx)` | Canvas bottom-center Panel | KEEP COMMAND-HIDE UI | add resource/undo/redo 命令 → Composer/Action Arc | no (LCOS mode ✓) | yes | Wave 2 ✓ 浏览器验证 |
| `Controls (CanvasZoomLevel/Interactivity)` | Canvas bottom-left | KEEP COMMAND-HIDE UI | LCOS camera controls Wave 4 提供；ctrl+wheel/中键/pinch 仍走 kernel | no (LCOS mode ✓) | yes | Wave 2 ✓ |
| `MiniMap` | Canvas bottom-right | KEEP COMMAND-HIDE UI | Wave 4 Locator 取代 | no (LCOS mode ✓) | yes | Wave 2 ✓ |
| `ChatPanel` | 无生产 caller（原 PreviewWorkspace chat tab） | PARTIAL（视觉待迁移）/KEEP KERNEL(transport) | `useAgentStream`/session/retry/waiting_input 仍只在 PreviewWorkspace；ConversationWorkView 当前只有 Core identity/runs/review/recovery。待 Core/T7 产出显式 `threadId`↔`connectedConversationId` 关联及 transcript read 后，再接薄 adapter，不复制 store/transport | no | yes（原 transport/session 可复用） | `docs/audit/GEN2_T4_T7_HuabuChatPanel_to_ConversationWorkView_GAP_20260914.md`；Wave 8 声明修正 |
| `WindowChrome` | RootLayout | KEEP KERNEL(OS 框架) | Electron 窗口机械留；`/spaces` 上不再挂 Huabu `AppMenu`（产品入口由 LCOS 启动页唯一渲染） | yes | n/a | Wave 1 ✓ |
| `GlobalModals` | RootLayout | KEEP COMMAND-HIDE UI | Settings/Shortcuts 单例；入口由 LCOS chrome 触发 | yes(单例) | yes | Wave 1 |
| native node body (NoteNode 等) | NodeWrapper children | FALLBACK/REPLACE(已绑定) | binding-aware seam 接管；native 仅 unbound/unsupported/unavailable | 仅 fallback | n/a | Wave 3 |
| `EdgeStyleToolbar` | Canvas selected edge | KEEP COMMAND-HIDE UI | SET_EDGE_STYLE/disconnect 命令 → selection inspector/Action Arc | no | yes | Wave 3/9 |
| `LcosHostOverlay.tsx` | useLcosCanvasProps | KEEP(仅 canvas-local) | 只留 drop hint/reference badge；产品 UI 移 Shell | 仅 canvas-local | n/a | Wave 2 |
| `LcosComposerShell.tsx`（Phase A04 旧 composer） | LcosHostOverlay | RETIRED（已删除文件） | 生产 `LcosComposerHost` 仍由唯一 `LcosHostOverlay` 承载，但只在 Action Arc 发出 selection-local intent 后靠近目标挂载；route-level 常驻底栏已退役 | no（旧壳） | n/a（草稿 store 仍为 reference store） | `scripts/e2e/gen2-ux-runtime-contract.mjs`：首屏 0、明确 intent 后 1、不得覆盖 Dock |
| `ProfessionalWindowStage` 旧 overlay 挂法 | useLcosCanvasProps overlays | REPLACE | 提升 route-level sibling；不再 `top:56` 躲旧按钮 | 新 shell 挂 | n/a | Wave 5 |
| Core 夹具 `real-dev-project.ts` 的 `canvasId` | `ensureRealDevProject` | 修正（原为缺陷） | 原先写死 `canvas-lcos-main/-context/-workflow` 三个 **Huabu 并不存在** 的画布 id；干净数据目录下首屏必然 404「现场加载失败」。改为不预设：缺省即走真实 `createCanvas` + 回写 workspace | n/a | n/a | Wave 1 ✓ 干净环境由 `empty` 态走真实建立路径后 `.react-flow` 唯一 |
| `useLcosWorksite::ensureWorkspaceCanvas` | `LcosWorksiteStage` / Shell | 修正（原为缺陷） | 原在 `setWorkspaces` 的 updater 里再调 `setSurfaceCanvasMap` → React 报 "Cannot update a component while rendering a different component"（干净数据目录首次建立画布时触发）。改为闭包内算好 `next`，两个 setter 独立调用 | n/a | n/a | Wave 1 ✓ 干净环境 `consoleErrors: []` |

## 已登记未完成（不伪造，逐项等下一轮）

| 项 | 现状 | 归属 |
|---|---|---|
| LCOS Entry Chrome（唯一产品入口） | 尚无：AppMenu 动作（new/import canvas、switch workspace、settings、shortcuts、handbook、diagnostics、update）目前在 Electron `WindowChrome`（仅 `/setup`）与各旧 Header 内；浏览器模式无任何产品入口 | Wave 4（Main + HUD + Navigator） |
| Huabu 独立画布命令 | `useCanvasActions.create/import`（Cmd/Ctrl+N、`NativeMenuBridge`、`AppMenu`）仍是 Huabu「独立画布」模型：创建出的画布没有 workspace 绑定，落到 `/canvas/:id` 的 `unbound` 诚实面，不再伪装成功。需改为 LCOS workspace 作用域创建 | Wave 4/5（Composer / Action Arc 命令迁移） |
| `/canvas/:id` 深链的「返回来源现场」按钮 | 因复用 `childWorkspaceId` 通道，直接深链进入时也显示该按钮（点击回 `/projects/<id>/main`）。语义上略显突兀，需在 Wave 4 决定是否改为「直接寻址」标记 | Wave 4 |
| 两套 overlay 仲裁并存 | `useTrackCanvasAttention`（Huabu `isCanvasEngaged`，已由 `CanvasPage` 在 LCOS 路径续挂）与 LCOS 自己的 `visibleOverlays` 仲裁尚未合并 | Wave 2/4 复核 |
| 浏览器未覆盖的 Wave 1 条款 | 正本 Wave 1「back/forward 不丢 pending save」：本次只验证了 Shell/identity 不丢；**pending save drain** 由 `RootLayout` 的 `useBlocker` 承担，尚未在浏览器里制造真实脏改动来验证 | Wave 1 收口补测 / Wave 2 |

旧文件物理保留（不动）作回滚/donor；整机稳定后单独清理 dead UI。任何旧 GUI 恢复必须通过 route composition 一次性切换，禁止新旧两棵树同时挂 production。