# local-creative-os-gen2

LCOS Gen2 — 本地创作项目总导演台（Local Core truth + Huabu spatial kernel + LCOS 产品前端）。

## GEN2 前端产品组合根

LCOS GEN2 的 production UI 由 route-level `LcosProjectShell`（`/projects/:projectId/:surface?`）统一组合。Huabu 是唯一 Canvas kernel，负责 ReactFlow、空间拓扑、geometry、viewport、selection、drag、resize、connect gesture 与 spatial history；Local Core 是 Project/Artifact/Conversation/Run/Result/Review/Revision 的 canonical truth。

生产调用链：

```text
App route
→ LcosProjectRoute（/projects/:projectId/:surface?）
→ LcosProjectShell
→ LcosWorksiteStage
→ Canvas Host （Huabu Canvas kernel；Wave 2 收口为 CanvasHostBoundary）
```

Global HUD、Railway、Professional Window、Context Atlas、Workflow Hand 与 Composer 属于 LCOS Shell/Worksite。Composer 可通过唯一受控 canvas portal 做对象近场呈现；它不进入 Canvas truth，也不作为 route-level 常驻底栏。其余项目级产品壳不得塞进 Canvas overlay。

Main、Context、Workflow 是同一 Project 的三个语义工作现场，共享 entity identity 和同一 Canvas mechanics；不是三套 graph/store/runtime。三现场各自独立 camera/selection/layout/history，canvasId 由 Core workspaces 提供（首进由 SurfaceDock 建立并回写）。

旧 Huabu `MainLayout`、`CanvasHeader`、`CanvasLayerPanel`、`PreviewWorkspacePanel`、CenterArea 浮动按钮和 NodeToolbar 不进入 LCOS production route。对应命令与机械可通过 adapter 复用；Huabu dev mode（`/spaces`、`/canvas/:id`）保留原 UI。

节点呈现通过 binding-aware `CanvasNodePresentationSeam` 接管内容和视觉（Wave 3 起）；Huabu `NodeWrapper` 继续拥有 geometry、selection、resize 和 pointer arbitration。native body 只在 unbound、unsupported、stale binding 或 runtime unavailable 时诚实 fallback。

## 施工文档

- 前端 UX 唯一挂载树与 owner 合同：`docs/construction/GEN2_FRONTEND_UX_RUNTIME_CONTRACT.md`
- 施工认知与账本：`docs/construction/PROJECT_READBACK.md`、`SOURCE_ADOPTION_LEDGER.md`、`FIGMA_SOURCE_LEDGER.md`、`HUABU_RETIREMENT_LEDGER.md`
- 逐 Wave handoff：`docs/handoffs/GEN2_NewFrontend_WaveN_*.md`
- 浏览器验收脚本：`scripts/e2e/`（本地 Chromium + playwright-core）
