# SOURCE_ADOPTION_LEDGER — 现成轮子承接账本

初始化：2026-09-13（分支 frontend-reconstruction-v2，基线 main@63188c2）
依据：`09_T1-T7现成轮子承接补丁卡.md` + `appendices/A_Gen1_Donor_ExactAudit.md` + `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md`

采用级别：A=纯逻辑直接 import；B=机制/数据流复用、重写视觉壳；C=借算法/编排、Gen2 边界内重写；X=禁止迁移旧 runtime/store/产品壳。

每个用户可见能力一行：donor exact repo/commit/file/symbol → 级别 → Gen2 target → production caller → 替换的旧 UI → real owner → fallback → evidence。状态仅用 PLANNED/ADOPTED/ADAPTED/VERIFIED/GAP。

## 九面设计状态基准（禁合并为一句 READY）

| 面 | designStatus | designReadyScope | stateCoverage | sourceBindingStatus |
|---|---|---|---|---|
| launcher | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| main | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| context | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| workflow | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| atlas | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| temporal | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| window | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| reader | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |
| hud | DESIGN_READY | 1440 当前主构图 | PARTIAL_COMPOSITION | NEEDS_SOURCE_BINDING |

## T1–T7 源级轮子承接表（增量维护）

| ID | 用户能力 | donor exact | 级别 | target file/symbol | production caller | 替换旧 UI | real owner | status | evidence |
|---|---|---|---|---|---|---|---|---|---|
| T1-A01 | Canvas kernel boundary | Huabu `components/Panels/Canvas/Canvas.tsx::Canvas` + ReactFlow | C | `lcos/host/CanvasHostBoundary.tsx` | `LcosProjectShell → LcosWorksiteStage → CanvasHostBoundary` | LCOS mode 下旧 chrome 不挂（NodeToolbar/Controls/MiniMap） | Huabu kernel | ADOPTED | Wave 2 handoff + wave2-kernel/gestures/parity e2e |
| T1-A02 | Node body seam | Huabu `NodeWrapper.tsx::NodeWrapper` + `lcos-seam/nodeBodySlot.tsx` | B | `lcos/nodes/createLcosNodePresentationSeam.ts` + `lcos/nodes/useLcosDensity.ts` | `useLcosCanvasProps.resolveNodeBody` → `NodeWrapper` | native body 降 fallback | Huabu geometry | VERIFIED | Wave 3+9 handoff；`NodeWrapper` 发布呈现输入（Wave 9 补挂），wave9 e2e 证明密度按屏幕像素（zoom 0.29 → mark，旧 zoom 阶梯会判 summary） |
| T1-A03 | 相机纯函数 | GEN1 `canvasGeometry.ts::{zoomCameraAt,applyWheelGesture,fitBounds,revealNode,nodeDensity,nodeDimensions,placeNewNodesIncrementally}` | A | `apps/web-gen2/src/spatial/`（并入现有 geometry 或 gen1CanvasMath） | camera port | 不迁 GEN1 Canvas | Huabu camera | PLANNED | 待 Wave 9 |
| T1-A05 | 视觉 family/descriptor | GEN1 `CanvasNodeVisual.tsx::{nodeVisualFamily,displayNodeTitle,nodeSecondaryLine,detectFileIdentity}` | A/B | `apps/web-gen2/src/presentation/nodeSpecies.ts` | `createNodePresentationSeam` | 不按 note 猜语义 | Core metadata | ADAPTED(现有 visualFamily) | Wave 3 扩展 |
| T1-A06 | 物种 registry | GEN1 `nodeCardRegistry.tsx::{registerNodeCard,resolveNodeCard}` | B | `apps/web-gen2/src/presentation/rendererRegistry.ts` + `lcos/nodes/*Body.tsx` | `LcosNodePresentationProvider` | 禁止 silent fallback | Core + Huabu | PLANNED | 待 Wave 3 |
| T1-A09 | Portal/Surface | GEN1 `SurfaceComponentLayer.tsx`、`surfaceComponentRegistry.tsx`、`PortalComponent.tsx`、`SurfaceComponentImmersive.tsx` | B | `lcos/portal/WorksitePortalHost.tsx` | Main/Context/Workflow worksite | 不建第二 graph | Huabu kernel | PLANNED | 待 Wave 6 |
| T2-A01 | 三现场 canvasId | archive `workspace.canvasId` Core/client | A | `lcos/shell/LcosSurfaceDock.tsx` + `LcosProjectRoute.tsx` | `LcosProjectShell` | 旧 bottom capsule 视觉不救 | Core | PLANNED | Wave 0 救回数据 |
| T2-A02 | Railway | GEN1 WorkspaceRail/dock 机制 + T2 C2-1C | B/C | `lcos/shell/LcosRailway.tsx`、`navigation/railwayProjection.ts` | `LcosProjectShell` | 旧 LayerPanel/sidebar 不挂 | Core view order | PLANNED | 待 Wave 4 |
| T2-A03 | Project Search | GEN1 `ProjectSearchLens.tsx::{anchorLabel,humanKind,resultFromRemote,matchReasonLabel}` | A/B | `navigation/projectSearch.ts` + `lcos/navigation/LcosProjectSearch.tsx` | Global HUD Cmd+F | 旧 search UI 退出 | Core search | PLANNED | 待 Wave 4 |
| T2-A05 | Locator | archive `locatorGeometry.ts/locatorState.ts/arrivalState.ts/spatialFocusPort.ts` | A | `lcos/navigation/LcosLocatorOverlay.tsx` | shell overlay → 唯一 camera | 旧 MiniMap | Huabu camera | PLANNED | Wave 0 救回 |
| T3-A03 | commandDraft | GEN1 `commandDraft.ts::{orderedReferenceForNode,resolveComposerReceiver,referenceCandidates,explicitExecutionReferenceIds,mergeExecutionContextIds}` | A | `apps/web-gen2/src/composer/*` | `LcosComposerHost` | 不迁旧 global state | Core + Bridge | PLANNED | 待 Wave 5 |
| T4-A01 | Professional Stage | Huabu PreviewWorkspace mechanics + T4 window 规划 | B/C | `lcos/professional/ProfessionalWindowStage.tsx` | `LcosProjectShell` route-level sibling | 旧 PreviewWorkspacePanel 不挂 | T4 + Huabu preview | PLANNED | 待 Wave 5 |
| T4-A02 | Reader | GEN1 `artifactViewerRegistry.tsx::{resolveArtifactViewerKind,canPreviewArtifact,ArtifactViewerHost}` | A/B | `ArtifactReaderBody.tsx` + viewer registry | Professional Body Registry | 旧常驻 preview 右栏退出 | Core revision | PLANNED | 待 Wave 5 |
| T6-A01 | projection/binding | archive + 现有 `ProjectToSpaceProjection`/`ProjectionBinding`/`reconciliationRunner` | A | `apps/web-gen2/src/spatial/*`（扩全 species） | `useLcosHostRuntime` | 不建 per-entity reconciler | Core | KEEP(main 已有) | Wave 0 核验 |
| T7-A01 | Glyth | GEN1 `ConversationGlyth.tsx`、`glythMotion.ts`、`glythBloub.ts`、`glythSemanticLod.ts` | A/B | `lcos/nodes/GlythNodeBody.tsx` + shared runtime | binding-aware node seam | 不做永久机器人按钮 | Core conversation | PLANNED | 待 Wave 8 |
| VOICE | voice 回填 | archive `7626ee2 voiceInput.ts` + tests | A | `apps/web-gen2/src/interaction/voiceTextMerge.ts` | Composer input | browser SpeechRecognition 不冒充 Core voice | Core voice route | PLANNED | Wave 0 救回 |
| W9-M01 | 相机移动暂停复杂动画 | Huabu（本仓）`@xyflow/react::useViewport` 变换流 | B | `lcos/host/LcosCameraMotionPolicy.tsx` + `lcos/ui/lcos.css` | `useLcosCanvasProps` overlays → 唯一 canvas | 不新建第二相机/不做逐帧 setState | Huabu camera | VERIFIED | wave9 e2e：`data-lcos-camera-moving` 滚轮期间出现、落定 140ms 后清除 |
| W9-A01 | Esc 关闭最上层专业窗口 | Huabu（本仓）`hooks/useCloseOnEscape.ts::useCloseOnEscape` | A（直接复用） | `lcos/professional/ProfessionalWindowStage.tsx` | route-level Professional Stage | 不新增第二套 Esc 栈 | Huabu hook | VERIFIED | wave9 e2e：窗口开→Esc→窗口关且画布存活；关闭按钮 `:focus-visible` 2px |
| W9-A02 | 44px 热区与焦点可见 | Huabu `--info` token + 本仓 lcos tokens | B | `lcos/ui/lcos.css`、`lcos/navigation/LcosCameraControls.tsx`、`lcos/shell/LcosSurfaceDock.tsx` | 全部 LCOS HUD 控件 | 不覆盖 Huabu 原生控件样式 | LCOS UI | VERIFIED | wave9 e2e：相机按钮 44×44、身份胶囊 234×44、dock 按钮 80×44，均 `solid 2px rgb(46,144,255)` |

> 规则：新增可见组件前先搜本表；已列 donor 优先 A/B/C 承接；确不能用时写清具体依赖冲突，禁止笼统写"旧代码不合适"。