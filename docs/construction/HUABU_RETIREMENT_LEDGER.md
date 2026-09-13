# HUABU_RETIREMENT_LEDGER — 旧壳退役与内核保留账本

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
| `Canvas.tsx` | CenterArea | KEEP KERNEL | 唯一 ReactFlow；新增 chromeMode/slots；LCOS mode 隐藏 NodeToolbar/Controls/MiniMap | yes（唯一一份） | yes | Wave 2 |
| `NodeToolbar (CanvasToolbar.tsx)` | Canvas | KEEP COMMAND-HIDE UI | add resource/undo/redo 命令 → Composer/Action Arc | no (LCOS mode) | yes | Wave 2/5 |
| `ChatPanel` | PreviewWorkspace chat tab | REPLACE(视觉)/KEEP KERNEL(transport) | useAgentStream/session/retry/waiting_input 复用 → ConversationWorkView | no | yes | Wave 8 |
| `WindowChrome` | RootLayout | KEEP KERNEL(OS 框架) | Electron 窗口机械留 | yes | n/a | Wave 1 |
| `GlobalModals` | RootLayout | KEEP COMMAND-HIDE UI | Settings/Shortcuts 单例；入口由 LCOS chrome 触发 | yes(单例) | yes | Wave 1 |
| native node body (NoteNode 等) | NodeWrapper children | FALLBACK/REPLACE(已绑定) | binding-aware seam 接管；native 仅 unbound/unsupported/unavailable | 仅 fallback | n/a | Wave 3 |
| `EdgeStyleToolbar` | Canvas selected edge | KEEP COMMAND-HIDE UI | SET_EDGE_STYLE/disconnect 命令 → selection inspector/Action Arc | no | yes | Wave 3/9 |
| `LcosHostOverlay.tsx` | useLcosCanvasProps | KEEP(仅 canvas-local) | 只留 drop hint/reference badge；产品 UI 移 Shell | 仅 canvas-local | n/a | Wave 2 |
| `ProfessionalWindowStage` 旧 overlay 挂法 | useLcosCanvasProps overlays | REPLACE | 提升 route-level sibling；不再 `top:56` 躲旧按钮 | 新 shell 挂 | n/a | Wave 5 |

旧文件物理保留（不动）作回滚/donor；整机稳定后单独清理 dead UI。任何旧 GUI 恢复必须通过 route composition 一次性切换，禁止新旧两棵树同时挂 production。