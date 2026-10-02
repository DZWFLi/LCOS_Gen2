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
| T2-A01 | 三现场 canvasId | archive `workspace.canvasId` Core/client | A | `lcos/shell/LcosSurfaceDock.tsx` + `LcosProjectRoute.tsx` | `LcosProjectShell` | 旧 bottom capsule 视觉不救 | Core | VERIFIED | Main/Context/Workflow 仅在 Dock；真实 `switchCanvas` + workspace canvasId；UX runtime e2e |
| T2-A02 | Railway | GEN1 `WorkspaceRailVNext.tsx` + `workspaceRailOrder.ts::orderProjectRailViews`；T2 C2-1C | B/C | `lcos/shell/LcosRailway.tsx`、`navigation/railwayProjection.ts` | `LcosGlobalHud` | 旧 LayerPanel/sidebar 不挂；禁止第二套三 Surface | Core view order | ADAPTED | 已读 Core order、过滤旧 root seeds、按真实 item 数量 hug；具体 Worksite activation、Drop、reorder/CAS、preview 仍 GAP，见 2026-09-14 UX runtime handoff |
| T2-A03 | Project Search | GEN1 `ProjectSearchLens.tsx::{anchorLabel,humanKind,resultFromRemote,matchReasonLabel}` | A/B | `navigation/LcosNavigatorIsland.tsx` | Global HUD Cmd/Ctrl+F | 旧 search UI 退出 | Core search | VERIFIED | 真实 Core search + loading/empty/error + 同画布 Locate；跨现场具体 arrival 仍登记 GAP |
| T2-A04 | Spatial Navigator | Huabu `Canvas.tsx` 的唯一 ReactFlow context、viewport zoom、MiniMap、interactivity lock + `canvasStore` 的 MiniMap/UI preference；T2 C2-3B 卡 | B | `lcos-seam/types.ts::CanvasSpatialNavigatorRenderer` + `lcos/navigation/LcosSpatialNavigator.tsx` | `useLcosCanvasProps.spatialNavigator` → `CanvasSpatialNavigatorMount` | `LcosCameraControls` production caller 与 stock Controls/MiniMap 退出 | Huabu Canvas + `LcosCanvasCommands` camera consumer | VERIFIED | `spatial-navigator-production.mjs`：单一 navigator/minimap，zoom/fit/reset、lock、grid/minimap reload、MiniMap pan、Main↔Context，console/page error 0 |
| T2-A05 | Locator | archive `locatorGeometry.ts/locatorState.ts/arrivalState.ts/spatialFocusPort.ts` | A | `lcos/navigation/LcosLocatorOverlay.tsx` | shell overlay → 唯一 camera | 旧 MiniMap | Huabu camera | PLANNED | Wave 0 救回 |
| T3-A03 | commandDraft | GEN1 `commandDraft.ts::{orderedReferenceForNode,resolveComposerReceiver,referenceCandidates,explicitExecutionReferenceIds,mergeExecutionContextIds}` | A | `apps/web-gen2/src/composer/*` | `LcosActionArc` → canvas-local `LcosComposerHost` | 不迁旧 global state；不挂常驻底栏 | Core + Bridge | VERIFIED | 显式对象命令才打开、单实例、靠近目标、提交真实 Run；`scripts/e2e/gen2-ux-runtime-contract.mjs` |
| T4-A01 | Professional Stage | Huabu PreviewWorkspace mechanics + T4 window 规划 | B/C | `lcos/professional/ProfessionalWindowStage.tsx` | `LcosProjectShell` route-level sibling | 旧 PreviewWorkspacePanel 不挂 | T4 + Huabu preview | ADAPTED | 唯一 Stage + body registry + close/Esc 已接；浮动可达，停靠/分组拓扑仍 GAP |
| T4-A02 | Reader | GEN1 `artifactViewerRegistry.tsx::{resolveArtifactViewerKind,canPreviewArtifact,ArtifactViewerHost}` | A/B | `ArtifactReaderBody.tsx` + viewer registry | Professional Body Registry | 旧常驻 preview 右栏退出 | Core revision | ADAPTED | Reader 入口与元数据态可达；完整正文/媒体 viewer 接线仍 GAP |
| T6-A01 | projection/binding | archive + 现有 `ProjectToSpaceProjection`/`ProjectionBinding`/`reconciliationRunner` | A | `apps/web-gen2/src/spatial/*`（扩全 species） | `useLcosHostRuntime` | 不建 per-entity reconciler | Core | KEEP(main 已有) | Wave 0 核验 |
| T7-A01 | Glyth | GEN1 `ConversationGlyth.tsx`、`glythMotion.ts`、`glythBloub.ts`、`glythSemanticLod.ts` | A/B | `lcos/nodes/GlythNodeBody.tsx` + shared runtime | binding-aware node seam | 不做永久机器人按钮 | Core conversation | PLANNED | 待 Wave 8 |
| VOICE | voice 回填 | archive `7626ee2 voiceInput.ts` + tests | A | `apps/web-gen2/src/interaction/voiceTextMerge.ts` | Composer input | browser SpeechRecognition 不冒充 Core voice | Core voice route | PLANNED | Wave 0 救回 |
| W9-M01 | 相机移动暂停复杂动画 | Huabu（本仓）`@xyflow/react::useViewport` 变换流 | B | `lcos/host/LcosCameraMotionPolicy.tsx` + `lcos/ui/lcos.css` | `useLcosCanvasProps` overlays → 唯一 canvas | 不新建第二相机/不做逐帧 setState | Huabu camera | VERIFIED | wave9 e2e：`data-lcos-camera-moving` 滚轮期间出现、落定 140ms 后清除 |
| W9-A01 | Esc 关闭最上层专业窗口 | Huabu（本仓）`hooks/useCloseOnEscape.ts::useCloseOnEscape` | A（直接复用） | `lcos/professional/ProfessionalWindowStage.tsx` | route-level Professional Stage | 不新增第二套 Esc 栈 | Huabu hook | VERIFIED | wave9 e2e：窗口开→Esc→窗口关且画布存活；关闭按钮 `:focus-visible` 2px |
| W9-A02 | 44px 热区与焦点可见 | Huabu `--info` token + 本仓 lcos tokens | B | `lcos/ui/lcos.css`、`lcos/navigation/LcosSpatialNavigator.tsx`、`lcos/shell/LcosSurfaceDock.tsx` | 全部 LCOS HUD 控件 | 不覆盖 Huabu 原生控件样式 | LCOS UI | VERIFIED | wave9 e2e + Spatial Navigator production e2e：导航键 44×44、折叠壳 52×48、可见 focus ring |
| W10-R01 | Run 结果复核（Review / Artifact Return） | Core 既有 `GET /projects/:pid/runs`（returns + draftRevisions + capabilities）+ `POST /artifact-returns/:id/{accept,reject,retry}`（`routes/runtime-reviews.ts`）+ contracts `RunReview` | A（直接消费既有 route/契约，不建第二 review truth） | `web-gen2 CoreRunClient.{listRunReviews,acceptArtifactReturn,rejectArtifactReturn,retryArtifactReturn}` + `lcos/professional/ArtifactReturnSection.tsx` | `ConversationWorkViewBody` 复核段 | 无（此前该能力完全无入口） | Core `RuntimeReviewService` | ADOPTED | wave10 e2e 真实 capability 原因（`no_pending_artifact_return`）；web-gen2 3 tests + 组件 3 tests；启用路径因真实库无 pending return 未端到端触发 |
| W10-C01 | Run 提交（Composer → Core） | Core `POST /projects/:pid/runs` + 真实 workspace（`workspace-real-main`） | B（修真实缺陷：写死 `workspaceId:'main'` → 409 外键；conversation 冒充 contextArtifact） | `lcos/composer/LcosComposerHost.tsx`、`lcos/shell/LcosProjectShell.tsx` | route-level Composer | 无 | Core Run | VERIFIED | wave10 e2e：Cmd/Ctrl+Enter → 真实 `Run 已创建` 回执、输入清空、console 0 error；修复前为真实 409 |

> 规则：新增可见组件前先搜本表；已列 donor 优先 A/B/C 承接；确不能用时写清具体依赖冲突，禁止笼统写"旧代码不合适"。

## 2026-10-02 · R14 复用替换与原生文本接线（代码候选，非整机验收）

本段按用户最新要求记录实际来源，不沿用旧表中“重写视觉壳”作为默认方案。已有正确机械、G1 已认可集合主体、历史引用和发送保护继续保留。未安装或未运行的库不标 VERIFIED。

| 能力 | 实际采用来源／符号 | G2 生产入口 | 替换或新增的适配 | 保留内容／验证范围 | 状态 |
|---|---|---|---|---|---|
| 多选与 Arc 的嵌套弹层 | 项目已声明的 `@floating-ui/react`：`FloatingTree`、`FloatingNode`、`FloatingPortal`、`useDismiss`、`FloatingFocusManager`；官方 FloatingTree/useDismiss/FocusManager 组合方式 | `ToolbarPopover` → `FloatingToolbar.ColorPicker/AlignPicker` → `MultiSelectToolbar`；原 `CanvasFloatingPopover` → `LcosActionArc` | 移除父层手写 document 外侧监听；受控开关、现有锚点与命令接入，子 portal 继承原树 | 保留真实外侧关闭、右键、焦点、键盘及既有位置避让。新增 6 条真实组件测试，但依赖未取得，正式 Vitest/实际 Floating UI 运行尚未通过 | ADAPTED |
| 多选整理 | `DZWFLi/LCOS-local-creativeOS@3e99769bf106d68cecc54094662352bfaecf2bdd`：`apps/web/src/features/canvas/canvasVisualGeometry.ts::layoutVisualGrid/nodeVisualBounds`；`apps/web/src/features/layout/layoutGeometry.ts::removeLayoutOverlaps` | `LcosMultiSelectToolbar` → `selectionLayout` → `donor/gen1VisualLayout` → 现有 `setNodeGeometry` | 原函数保留，仅最小结构类型适配；实际实体种类、父坐标、锁定继承和无法完成的碰撞修复拒绝在接入端处理 | 不引入 G1 Canvas/相机/选择库；原生对齐、集合伴随移动与 Undo 留用；源码用例已运行 | ADAPTED |
| 编辑密度与临界稳定 | G2 既有 `resolvePresentationDensity`、Huabu `SEMANTIC_ZOOM_CONFIG.hysteresis`、React Flow 当前视口与节点快照 | `NodeWrapper` → `useLcosDensity` → 原有物种 body；原位编辑显式传 editing | 原节点数量封顶只作用背景；视口外/hidden 节点不计入；以原 resolver 和既有迟滞参数稳定临界 | 无第二 LOD/store/camera；编辑/拖动/缩放阶段优先；纯函数与实际几何输入测试通过，整机滚轮手感未验 | ADAPTED |
| 原生文本原位编辑与合法材料 | 项目既有 `MilkdownEditor`、`MilkdownFloatingToolbar`、`stripMarkdown`、`createTextArtifact`、`reviseManagedTextArtifact`、节点绑定与 metadata 事务 | `createLcosNodePresentationSeam` → `LcosCanvasTextBody` → `CoreArtifactClient` → `curation/canvas-text` → 既有文本服务 | 仅 current managed 文本/Markdown 或未绑定 native text；先保存 native 节点，再按该节点身份创建/修订。新正文/工作集/绑定同一事务，修订检查在事务内；原回执核对不重造材料 | 保留原节点/空间几何、旧正文、并发版本、草稿、引用模式、输入法、取消与迟到回执保护。SQLite/生产路由测试通过；浏览器文本保存流程用显式 Milkdown/画布替身，不能证明原生富文本或整机通过 | ADAPTED |
| 正式入口测试 | 仓库已有 `GlythStateActions.test.tsx`、`LcosComposerHost.references.test.tsx`；R12 原整理回归 | 真实右键 More 与＋引用入口；实际原整理函数 | 只调整已由用户明确更正的旧入口/网格预期，保留原失败日志，并新增边界测试 | 正式 React19/Vitest 因缺依赖未运行；另有 node:test 源码套件复跑，不能相互替代 | ADAPTED |

### 本批不改的东西

- R13 的 G1 CollectionFace、CSS、SVG 保持原文件字节；不增加集合管理流程。
- 不修改依赖清单、锁文件、数据库表结构；不推送 GitHub。
- 不替换整个专业窗口，不重写装配瀑布流，不重开 Context/Workflow 产品定义。
- 本批只补原生文本的合法材料通道，不宣称所有图片、影音或外部来源已接入。
- 不将旁路编辑直接写入历史版本、未受管导入材料、运行草稿或尚未明确身份的绑定。

### 来源与验证入口

原布局取源路径见上表；Floating UI 的具体 API 来自项目既有依赖和官方文档：`https://floating-ui.com/docs/floatingtree`、`https://floating-ui.com/docs/usedismiss`、`https://floating-ui.com/docs/floatingfocusmanager`。

新增生产源码测试：`apps/web-gen2/test/r14-reuse-restoration.test.ts`、`scripts/tests/r14-canvas-text-core.test.ts`；新增真实 Floating UI 组件测试：`huabu/apps/web/src/components/Common/ToolbarPopover.test.tsx`。完整执行日志、实际命令、未通过的正式检查与浏览器替身清单随 R14 交付包保存，不用旧表历史 VERIFIED 状态代替本批事实。


## R15 · 既有正文组件复用与异步读写连续性（2026-10-02）

本轮输入为原上传工作区实际叠加 R1–R14 的副本，不代表用户桌面另有改动的版本。没有换正文引擎、没有新增依赖、没有重画集合或窗口。以下是代码接线及隔离验证，不是整机验收状态。

| 工作项 | 原实现 → 实际调用者 | 本轮适配／退役范围 | 状态与证据 |
|---|---|---|---|
| Markdown Reader | 当前 Huabu `components/Milkdown/{MilkdownPreview,createMilkdown}` → `ReaderContentView` → `ArtifactReaderBody` | 正式 Markdown 读面停止调用弱逐行 `Gen1TextDocument`；旧 donor 文件保留。沿用现有 schema、parser、serializer、只读和安全链接处理，不另写解析器 | ADAPTED；生产 import 已接。真实 Milkdown/React19 测试因缺依赖未运行；控制工厂的 Reader 浏览器 16 场景通过 |
| 共享正文异步生命周期 | 同一 `MilkdownEditor` / `MilkdownPreview` 原组件 | 初始化完成前的最新正文／只读／标注、取消的实例 DOM 隔离、订阅清理、格式化不冒充用户编辑、显式错误回调；不改引擎工厂和既有块拖动 | ADAPTED；15 个真实 wrapper＋控制工厂浏览器场景通过；不是 parser 渲染证明 |
| 原位编辑续写 | R14 `LcosCanvasTextBody` + 原 Core 文本服务 | 元数据刷新保留输入实例；从当前未提交草稿读取，而非请求起点快照；旧读取不能覆盖新保存；编辑器重载不重新发送正文 | ADAPTED；21 个浏览器场景调用生产组件/客户端和真实 Core/SQLite，Milkdown 输入、画布状态为测试端口 |
| 版本阅读位置 | 已有 `readerPositions` → `ArtifactReaderBody` → `readerScrollRestore` | 渲染就绪后才消费原位置；单个内容区域的测量／图片完成／手动操作取消属于 DOM 适配，不新增位置数据库、相机或滚动引擎 | ADAPTED；含隐藏重显、切版本、晚到渲染、图片尺寸和用户输入优先的浏览器验证 |

READ_SOURCE：本仓共享 Milkdown 组件、createMilkdown、markdownUtils、blockDrag、现有安全链接逻辑；当前 `DocumentSourceView` 的 MilkdownPreview 调用；R14 原位编辑与 Reader 原调用；《R13 后复用替换与主流程施工安排》“原位编辑／Markdown阅读／版本位置”；《自写实现及 donor 偏离审计》05、07、09。用户最新口径为成熟实现优先、只做必要适配。

VISUAL_SOURCE：沿用 ReaderContentView 已标记的 Figma 5388:27484 与现有 professional-reading.css；本轮只作用于 Reader 正文内容范围。未重新取 Figma，未进行全页视觉保真验收。

RETIRED：Reader 主路径中的 Gen1TextDocument 调用、共享 wrapper 过期 pendingMarkdown 队列、正文未渲染时抢先恢复 scrollTop 的时序。没有删除历史 donor 文件、正确领域逻辑或安全措施。

VERIFIED：本轮重新执行既有 989 项源码/Core 测试；wrapper 生命周期 15、Reader 16、文本保存 21 个浏览器隔离场景；完整差分及应用/反向验证见随 R15 交付的 verification。计数分开，不将隔离测试升级为整机。

UNRESOLVED：正式依赖下载 EAI_AGAIN；正式 Vitest 不存在，实际 React19/Floating UI/Milkdown/Huabu 全应用未验。装配虚拟化、专业窗口采用路线、全部主画布组合动作和持久草稿恢复不计本轮完成。原有 MIT 版权声明保留；createMilkdown 引擎原文件和依赖清单保持不变。
