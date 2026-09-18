# HUABU_RETIREMENT_LEDGER — 旧壳退役与内核保留账本

> 2026-09-15 审计提示：历史行中 `command preserved=yes` 只可作为待复核声明，不证明LCOS生产入口已可达。PreviewWorkspace、CanvasHeader、CenterArea、NodeToolbar、EdgeStyleToolbar等必须补当前新入口/caller和行为证据；不得以隐藏旧UI作为迁移验收。新增核对入口见 `../audit/GEN2_UX框架总图与全旅程补漏_20260915.md`。
>
> 2026-09-19 Wave 1 实测更新（commit `0f0d66c`）：`/spaces` 与 `/canvas/:canvasId` 已改由 LCOS 接管；`CanvasPage`
> 的返回树不再出现旧三栏壳。证据：`apps/web/src/lcos/app/lcosProjectRoutes.routeComposition.test.ts`（源码组合树 gate）
> + `apps/web/src/pages/CanvasPage/CanvasPage.test.tsx`（行为）+ `tsc --noEmit` exit 0。
> **`production mounted? = no` 目前只有源码级证据**；浏览器三视口整页截图与真实 DOM 断言（正本 04 Wave 1「真实浏览器动作」）
> 仍待补，补齐前不得把本 Wave 记为已收口。

初始化：2026-09-13。依据 `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md` 结论标签。
标签：KEEP KERNEL（保留机械与 owner）；KEEP COMMAND-HIDE UI（命令保留、UI 不挂）；REPLACE（新 route/视觉接管）；FALLBACK（仅明确失败）；DEV-ONLY。

| old UI / symbol | current caller | 标签 | 新 seam/动作 | production mounted? | command preserved? | evidence |
|---|---|---|---|---|---|---|
| `App.tsx::RootLayout/App` router | main.tsx root | REPLACE(路由组合)/KEEP KERNEL(URL/loader/guard) | `/spaces`→`LcosProjectLauncherPage`（路由由 `lcos/app/LcosAppRoutes.tsx` 持有）；`/projects/:projectId/:surface?`→`LcosProjectRoute`；`/canvas/:canvasId`→`CanvasPage`（LCOS 入口） | element 已换；App.tsx 路由表不再注册 `/spaces` | yes | Wave 1 ✓ `routeComposition.test.ts` |
| `CanvasPage.tsx::CanvasPage` | App `/canvas/:canvasId` | REPLACE(返回树)/KEEP KERNEL(一次性 intent + 画布注意力) | 用 `useLcosCanvasBinding` 解析 canonical 归属（只走 Core `listProjects`+`getWorkspaces`，不猜）→ 交给唯一 `LcosProjectRoute` → `LcosProjectShell` | 不再返回 `MainLayout`；不再 import 五件 | yes（`newCanvasPlacement` / `previewNode` intent 保留并消费） | Wave 1 ✓ `CanvasPage.test.tsx` 5/5 |
| `MainLayout.tsx::MainLayout` | 无生产 caller（仅 `MainLayout.test.tsx`） | REPLACE | 宽度/resize 数学保留作迁移参考；production 不 mount | no | n/a | Wave 1 ✓ 源码组合树 gate |
| `CanvasHeader.tsx::CanvasHeader` | 无生产 caller | REPLACE(KEEP COMMAND-HIDE UI) | 菜单动作迁 LCOS Entry Chrome（见下方未完成项） | no | yes（`AppMenu`/`CanvasMenu` 实现保留） | Wave 1 ✓ |
| `CanvasLayerPanel::CanvasLayerPanel` | 无生产 caller | REPLACE | `buildTreeItems`/search/focus 抽 helper → Navigator/Context instruments | no | yes | Wave 1（无 caller）；Wave 4 接命令 |
| `PreviewWorkspacePanel` | 无生产 caller | REPLACE | preview target/tab/session/Escape 复用 → Reader/Work View | no | yes | Wave 1（无 caller）；Wave 5 接命令 |
| `CenterArea.tsx::CenterArea` | 无生产 caller | REPLACE | `LcosWorksiteStage` 直接挂 `CanvasHostBoundary`；Handbook/Settings/Bot 动作由 LCOS 入口接管 | no | yes | Wave 1 ✓ 源码组合树 gate |
| 画布 load/switch owner | `LcosWorksiteStage`（`switchCanvas`） | KEEP KERNEL（单一 owner） | 由 LCOS 舞台持有；`CanvasPage` 不再调用 `loadCanvas/switchCanvas`，避免第二写 owner | 唯一 | yes | Wave 1 ✓ `LcosWorksiteStage.test.tsx` |
| canvas SSE 订阅 owner | `useLcosCanvasProps` | KEEP KERNEL（单一 owner） | `connect/disconnect(canvasId)`；`CanvasPage` 不再订阅（原本两处都会订阅） | 唯一 | yes | Wave 1 ✓ `useLcosCanvasProps.project.test.tsx` |
| Cmd/Ctrl+F 搜索 | `LcosNavigatorIsland` | KEEP COMMAND-HIDE UI → REPLACE | Huabu `useGlobalSearchHotkey`（左栏搜索输入）随旧壳退役；LCOS Navigator 搜索接管同一快捷键 | 旧 hook 不再挂载 | yes（替换实现） | R6-5 / Wave 1 ✓ |
| `Canvas.tsx` | `CanvasHostBoundary` | KEEP KERNEL | 唯一 ReactFlow；`chromeMode="lcos"` 隐藏 NodeToolbar/Controls/MiniMap | yes（唯一一份） | yes | Wave 2 ✓ |
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

## 已登记未完成（不伪造，逐项等下一轮）

| 项 | 现状 | 归属 |
|---|---|---|
| 浏览器证据 | 正本 04 Wave 1「真实浏览器动作」：从列表进入 / 刷新 URL 不丢 identity / back-forward 不丢 pending save / DOM 断言旧五类未 mount / 1366×768·1440×900·1024×768 整页截图 —— 尚未执行 | Wave 1 收口必做 |
| LCOS Entry Chrome（唯一产品入口） | 尚无：AppMenu 动作（new/import canvas、switch workspace、settings、shortcuts、handbook、diagnostics、update）目前在 Electron `WindowChrome`（仅 `/setup`）与各旧 Header 内；浏览器模式无任何产品入口 | Wave 4（Main + HUD + Navigator） |
| Huabu 独立画布命令 | `useCanvasActions.create/import`（Cmd/Ctrl+N、`NativeMenuBridge`、`AppMenu`）仍是 Huabu「独立画布」模型：创建出的画布没有 workspace 绑定，落到 `/canvas/:id` 的 `unbound` 诚实面，不再伪装成功。需改为 LCOS workspace 作用域创建 | Wave 4/5（Composer / Action Arc 命令迁移） |
| `useTrackCanvasAttention` 覆盖 | 已由 `CanvasPage` 在 LCOS 路径续挂；但它驱动的是 Huabu `isCanvasEngaged`，而 LCOS overlay 用自己的 `visibleOverlays` 仲裁 —— 两套仲裁尚未合并 | Wave 2/4 复核 |

旧文件物理保留（不动）作回滚/donor；整机稳定后单独清理 dead UI。任何旧 GUI 恢复必须通过 route composition 一次性切换，禁止新旧两棵树同时挂 production。