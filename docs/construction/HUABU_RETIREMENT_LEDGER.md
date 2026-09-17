# HUABU_RETIREMENT_LEDGER — 旧壳退役与内核保留账本

> 2026-09-15 审计提示：历史行中 `command preserved=yes` 只可作为待复核声明，不证明LCOS生产入口已可达。PreviewWorkspace、CanvasHeader、CenterArea、NodeToolbar、EdgeStyleToolbar等必须补当前新入口/caller和行为证据；不得以隐藏旧UI作为迁移验收。新增核对入口见 `../audit/GEN2_UX框架总图与全旅程补漏_20260915.md`。

初始化：2026-09-13。依据 `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md` 结论标签。
标签：KEEP KERNEL（保留机械与 owner）；KEEP COMMAND-HIDE UI（命令保留、UI 不挂）；REPLACE（新 route/视觉接管）；FALLBACK（仅明确失败）；DEV-ONLY。

| old UI / symbol | current caller | 标签 | 新 seam/动作 | production mounted? | command preserved? | evidence |
|---|---|---|---|---|---|---|
| `App.tsx::RootLayout/App` router | main.tsx root | REPLACE(路由组合)/KEEP KERNEL(URL/loader/guard) | `/spaces`→`LcosProjectLauncherPage`；`/projects/:projectId/:surface?`→`LcosProjectShell`；`/canvas/:id` Huabu dev route 保留 | 路由 element 换 | yes | Wave 1 树检查 |
| `CanvasPage.tsx::CanvasPage` | App `/canvas/:canvasId` | REPLACE(返回树)/KEEP KERNEL(load/switch/sync) | 改为解析 projectId → `LcosProjectRoute` | 不再返回 MainLayout | yes | Wave 1 |
| `MainLayout.tsx::MainLayout` | CanvasPage | REPLACE | 宽度/resize 数学保留；production 不 mount | no | n/a | Wave 1 树检查 |
| `CanvasHeader.tsx::CanvasHeader` | CanvasPage→MainLayout.header | REPLACE(KEEP COMMAND-HIDE UI) | 菜单动作迁 LCOS Entry Chrom | no | yes | Wave 1 |
| `CanvasLayerPanel::CanvasLayerPanel` | MainLayout.leftPanel | REPLACE | buildTreeItems/search/focus 抽 helper → Navigator/Context instruments | no | yes | Wave 4 |
| `PreviewWorkspacePanel` | MainLayout.rightPanel | REPLACE | preview target/tab/session/Escape 复用 → Reader/Work View | no | yes | Wave 5 |
| `CenterArea.tsx::CenterArea` | MainLayout children | REPLACE | `LcosWorksiteStage` 直接挂 `CanvasHostBoundary`；Handbook/Settings/Bot 动作由 LCOS 入口接管 | no | yes | Wave 1–2 |
| `Canvas.tsx` | CenterArea | KEEP KERNEL | 唯一 ReactFlow；新增 chromeMode/slots；LCOS mode 隐藏 NodeToolbar/Controls/MiniMap | yes（唯一一份） | yes | Wave 2 ✓ |
| `NodeToolbar (CanvasToolbar.tsx)` | Canvas bottom-center Panel | KEEP COMMAND-HIDE UI | add resource/undo/redo 命令 → Composer/Action Arc | no (LCOS mode ✓) | yes | Wave 2 ✓ 浏览器验证 |
| `Controls (CanvasZoomLevel/Interactivity)` | Canvas bottom-left | KEEP COMMAND-HIDE UI | LCOS camera controls Wave 4 提供（Figma HUD 左下 52）；ctrl+wheel/中键/触摸 pinch 仍走 kernel | no (LCOS mode ✓) | yes | Wave 2 ✓ |
| `MiniMap` | Canvas bottom-right | KEEP COMMAND-HIDE UI | Wave 4 Locator 取代 | no (LCOS mode ✓) | yes | Wave 2 ✓ |
| `ChatPanel` | PreviewWorkspace chat tab | PARTIAL（视觉待迁移）/KEEP KERNEL(transport) | `useAgentStream`/session/retry/waiting_input 仍只在 PreviewWorkspace；ConversationWorkView 当前只有 Core identity/runs/review/recovery。待 Core/T7 产出显式 `threadId`↔`connectedConversationId` 关联及 transcript read 后，再接薄 adapter，不复制 store/transport | no（Work View 对话面缺失；原 ChatPanel 仍在 PreviewWorkspace） | yes（原 transport/session 可复用） | `docs/audit/GEN2_T4_T7_HuabuChatPanel_to_ConversationWorkView_GAP_20260914.md`；Wave 8 声明修正 |
| `WindowChrome` | RootLayout | KEEP KERNEL(OS 框架) | Electron 窗口机械留 | yes | n/a | Wave 1 |
| `GlobalModals` | RootLayout | KEEP COMMAND-HIDE UI | Settings/Shortcuts 单例；入口由 LCOS chrome 触发 | yes(单例) | yes | Wave 1 |
| native node body (NoteNode 等) | NodeWrapper children | FALLBACK/REPLACE(已绑定) | binding-aware seam 接管；native 仅 unbound/unsupported/unavailable | 仅 fallback | n/a | Wave 3 |
| `EdgeStyleToolbar` | Canvas selected edge | KEEP COMMAND-HIDE UI | SET_EDGE_STYLE/disconnect 命令 → selection inspector/Action Arc | no | yes | Wave 3/9 |
| `LcosHostOverlay.tsx` | useLcosCanvasProps | KEEP(仅 canvas-local) | 只留 drop hint/reference badge；产品 UI 移 Shell | 仅 canvas-local | n/a | Wave 2 |
| `LcosComposerShell.tsx`（Phase A04 旧 composer） | LcosHostOverlay | RETIRED（已删除文件） | 生产 `LcosComposerHost` 仍由唯一 `LcosHostOverlay` 承载，但只在 Action Arc 发出 selection-local intent 后靠近目标挂载；route-level 常驻底栏已退役 | no（旧壳） | n/a（草稿 store 仍为 reference store） | `scripts/e2e/gen2-ux-runtime-contract.mjs`：首屏 0、明确 intent 后 1、不得覆盖 Dock |
| `ProfessionalWindowStage` 旧 overlay 挂法 | useLcosCanvasProps overlays | REPLACE | 提升 route-level sibling；不再 `top:56` 躲旧按钮 | 新 shell 挂 | n/a | Wave 5 |

旧文件物理保留（不动）作回滚/donor；整机稳定后单独清理 dead UI。任何旧 GUI 恢复必须通过 route composition 一次性切换，禁止新旧两棵树同时挂 production。
