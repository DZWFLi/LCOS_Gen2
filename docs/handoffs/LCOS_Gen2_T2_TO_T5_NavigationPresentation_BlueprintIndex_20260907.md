# FROM T2 TO T5 · Navigation / Search / Marker Presentation Blueprint Index

> 日期：2026-09-07  
> 基线：`LCOS_Gen2/main@232b2ca5`  
> Huabu upstream：`a3c411e1f655191344285141f08c4738fa6015f7`  
> 目的：给 T5 提供长期可消费的 presentation seam 总索引  
> 状态词：`CURRENT` = 当前源码存在；`PLANNED` = 已有蓝图、未落地；`GAP` = 仍需 owner 输出或实现

## 0. 使用方式

这不是一张“全部开工”任务卡。T5 应逐 seam 消费：

1. 先看本索引的 owner、状态和禁区；
2. 再打开对应 exact blueprint；
3. 只回填 presentation、motion、collision 与视觉验收；
4. 不创建 Camera、canonical identity、Railway、Worksite 或 persistence 的第二 owner。

共同原则：

```text
Core / ProjectSession 提供 canonical identity 与 lifecycle
Huabu 提供 world geometry、Camera、viewport 与 spatial mechanics
T2 提供 navigation/search/pin presentation model 与编排
T4 提供 ProfessionalWindowEnvironment / safeRect / occupancy
T5 提供视觉形态、motion 参数、碰撞呈现与状态可读性
```

三视图独立现场状态已经关闭，不再 OPEN：Main / Context / Workflow 共享 Kernel 实现，但各自保持 camera、selection、layout、history。Railway `surface_root` 是导航 identity；它到实际工作现场的映射仍由 ProjectSession/Worksite owner 提供。

## 1. 总览

| Seam | Current substrate | Presentation | 主要 gate | T5 当前动作 |
|---|---|---|---|---|
| Project Search | CURRENT | PLANNED | ProjectSession mount、T6 location vocabulary | 可做视觉回填与 fixture 验证 |
| Focus / Where | CURRENT binding + Huabu focus mechanics | PLANNED | canonical destination resolver、safeRect port | 可定 HUD/occurrence 形态 |
| Color Pin | CURRENT Core contract/routes/ChangeSet | PLANNED | typed target migration、renderer seam | 可定 mark/HUD/多色状态 |
| Locator / Arrival | CURRENT Camera/bounds | PLANNED | spatial focus port、T4 environment | 可定 edge cue/arrival motion |
| Spatial Navigator | CURRENT Huabu controls/store | PLANNED exact neutral seam | ProjectSession mount | 可回填仪表视觉与碰撞 |
| Railway receive/navigation | V0 order CURRENT；Huabu move CURRENT | V1 PLANNED | T6 V1、T3 remote target、ProjectSession | 可定状态，不可假设 transaction 已有 |
| Worksite enter/back | Canvas switch CURRENT | PLANNED | T6 Worksite contract、active owner | 可定导航态与退化态 |
| Remote identity/marker | ProjectionBinding CURRENT；legacy marker CURRENT | migration PLANNED | T6 identity/lifecycle resolver | 可定一致视觉语法 |

## 2. Project Search

### Exact files

CURRENT：

```text
apps/web-gen2/src/backend/search.ts
packages/contracts/src/search.ts
apps/local-core/src/project-search-service.ts
apps/local-core/src/routes/curation.ts
apps/web-gen2/src/host/createLcosHostRuntime.ts
huabu/apps/web/src/components/Panels/CanvasSearch/*
```

PLANNED：

```text
huabu/apps/web/src/lcos/search/useProjectSearch.ts
huabu/apps/web/src/lcos/search/ProjectSearchHud.tsx
huabu/apps/web/src/lcos/search/ProjectSearchResults.tsx   optional split
huabu/apps/web/src/lcos/navigation/LcosProjectChrome.tsx mount
```

### State / event

Local UI state：closed/open、query、debouncing/loading、error、results、activeIndex、requestGeneration。使用一个 `AbortController` 取消旧查询。Project events 只触发失效/refetch，不另建第二 SSE。

Search result identity 是 canonical result identity；`locationRefs` 只是 read projection。结果浏览不自动移动 Camera；Enter/click 交给 Focus/Preview/Conversation action owner。

### Screen/world owner

- Search HUD/result list：screen-space，T2/T5；
- Canvas local search highlight：Huabu 当前 world-space mechanic；
- Project Search 不拥有 occurrence geometry 或 Camera。

### ProfessionalWindow collision

Search HUD 必须消费 T4 occupancy/safeRect，避开浮动 Work View 与 Project chrome。窗口开合只重排 HUD，不触发 Camera。

### Motion responsibility

T5：HUD enter/exit、result active transition、loading/error transition。Huabu：任何显式 focus 后的 Camera motion。禁止结果箭头浏览驱动连续 Camera。

### Acceptance

- ordinary LCOS `Cmd/Ctrl+F` 打开 Project Search；
- Preview-local Find 和显式 Canvas Search 仍保留；
- 多地点结果可读；
- 搜索不隐式创建 projection、不隐式移动 Camera；
- stale request 不覆盖新结果。

完整蓝图：`C:\Users\1\Desktop\222\LCOS_Gen2_T2_C2-2A_ProjectSearch_ExactSourceBlueprint_20260907.md`。

## 3. Focus / Where

### Exact files

CURRENT：

```text
apps/web-gen2/src/spatial/projectionBinding.ts
apps/web-gen2/src/backend/sqliteBindingStore.ts
apps/local-core/src/routes/spatial-bindings.ts
apps/local-core/src/metadata-repository.ts
apps/web-gen2/src/host/projectionFacade.ts
huabu/apps/web/src/components/Panels/CanvasLayerPanel/focusNodesOnCanvas.ts
```

PLANNED：

```text
apps/web-gen2/src/spatial/focusOccurrence.ts
huabu/apps/web/src/lcos/focus/useLcosFocus.ts
huabu/apps/web/src/lcos/focus/FocusHud.tsx
huabu/apps/web/src/lcos/navigation/LcosProjectChrome.tsx mount
```

T6 migration：

```text
packages/contracts/src/navigation-marker.ts
apps/local-core/src/navigation-marker-service.ts
```

### State / event

Presenter states：idle、resolving、single-current、multiple、remote、unavailable、archived、degraded、failed。ProjectionBinding change / canonical lifecycle event 使 occurrence snapshot 失效；T2 refetch，不缓存 geometry。

### Screen/world owner

- Focus HUD 与 occurrence chooser：screen-space，T2/T5；
- node bounds、union bounds、Camera execution：Huabu；
- ProjectionBinding 只存 canonical entity ↔ spatial identity，不存 position/bounds。

### ProfessionalWindow collision

Focus framing 必须接受 T4 safeRect；HUD 避开 Professional Window。Work View resize 可重新计算 framing/overlay placement，但不能由 T2 偷写 viewport。

### Motion responsibility

T5：HUD、候选切换、target cue。Huabu：fit/focus Camera motion。跨 worksite 时先导航 settlement，再执行 spatial focus；Arrival 由下一 seam 接管。

### Acceptance

- 当前 occurrence 直接 focus；
- 多 occurrence 可选择，且 canonical identity 不丢；
- remote occurrence 先进入目标 worksite，再 focus；
- geometry 移动后不依赖旧缓存；
- missing/archived 不制造假 projection；
- Professional Window 打开时目标仍在 safeRect。

完整蓝图：`C:\Users\1\Desktop\222\LCOS_Gen2_T2_C2-2B_Focus_Where_ExactSourceBlueprint_20260907.md`。

## 4. Color Pin

### Exact files

CURRENT：

```text
packages/contracts/src/color-pin.ts
apps/local-core/src/routes/color-pins.ts
apps/local-core/src/metadata-repository.ts
apps/local-core/src/mutation-safety-service.ts
apps/local-core/src/routes/change-sets.ts
packages/contracts/src/project-events.ts
apps/web-gen2/src/spatial/projectionBinding.ts
apps/web-gen2/src/host/projectionFacade.ts
```

PLANNED：

```text
apps/web-gen2/src/backend/colorPins.ts
apps/web-gen2/src/presentation/colorPinPresentation.ts
huabu/apps/web/src/lcos/pin/LcosColorPinProvider.tsx
huabu/apps/web/src/lcos/pin/ColorPinHud.tsx
huabu/apps/web/src/lcos/navigation/LcosProjectChrome.tsx mount
```

T1/T5 exact renderer seam：GAP。T6 typed target migration：PLANNED。

### State / event

Core owns definitions、memberships、ChangeSet、revert/reapply。Presenter owns loading、assigned、multiple-colors、unassigned、stale、failed。`project-events` 触发 snapshot invalidation；不在 node local state 复制 canonical membership。

### Screen/world owner

- Pin HUD/picker：screen-space；
- node-local identity mark：world object decoration，由 T1 renderer seam消费 T2 derived identities；
- Core 不存 Pin geometry；节点移动后 mark 跟随 renderer/node。

### ProfessionalWindow collision

HUD/picker 使用 T4 occupancy；node-local mark 不因窗口开合改写 world geometry。窗口遮挡只影响 locator/visibility presentation。

### Motion responsibility

T5：assign/remove acknowledgement、mark state transition、多色展开。避免持续流光；Pin 是 identity mark，不是 Camera command。

### Acceptance

- canonical entity 与 specific occurrence 两种目标不混淆；
- 同 Artifact 多 Worksite 呈现正确；
- 多色可辨且不只靠颜色；
- remove last membership 与 orphan definition 语义正确；
- revert/reapply 后 UI refetch；
- geometry 变化不破坏 pin identity。

完整蓝图：`C:\Users\1\Desktop\222\LCOS_Gen2_T2_C2-2C_ColorPin_ExactSourceBlueprint_20260907.md`。

## 5. Locator / Arrival

### Exact files

CURRENT：

```text
huabu/apps/web/src/store/canvasStore.ts
huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx
huabu/apps/web/src/components/Panels/CanvasLayerPanel/focusNodesOnCanvas.ts
apps/web-gen2/src/spatial/projectionBinding.ts
apps/web-gen2/src/host/projectionFacade.ts
huabu/apps/web/src/lcos/LcosHostOverlay.tsx
```

PLANNED：

```text
apps/web-gen2/src/spatial/locatorGeometry.ts
apps/web-gen2/src/interaction/locatorState.ts
apps/web-gen2/src/interaction/arrivalState.ts
huabu/apps/web/src/lcos/navigation/useLcosLocator.ts
huabu/apps/web/src/lcos/navigation/LcosLocatorOverlay.tsx
huabu/apps/web/src/lcos/LcosHostOverlay.tsx              extend for Arrival
```

T1 spatial focus port、T4 `ProfessionalWindowEnvironment` / `viewportResizePolicy`：GAP/DEPENDENCY。

### State / event

Locator：LOCAL、NEAR_EDGE、EDGE、UNAVAILABLE。Arrival：IDLE、TRAVELLING、ARRIVING、SETTLED、CANCELLED/FAILED。状态是 presentation，不写 Core。Project/canvas switch、archive、新 target、用户 Camera gesture 必须取消旧 travel/arrival token。

### Screen/world owner

- Locator edge cue：screen-space；
- Arrival target-local cue：ReactFlow/Canvas overlay seam，可使用 world target 经 Huabu 转 screen；
- bounds/world→screen/Camera：Huabu；
- safeRect：T4。

### ProfessionalWindow collision

Locator 使用扣除 Professional Window 后的 safeRect 判定 edge。窗口打开/resize 重新计算 cue；不自动移动 Camera。只有显式 Locator click/Focus request 才发 Camera request。

### Motion responsibility

T5：edge proximity 连续视觉、travelling/arriving/settled cue、取消态。Huabu：Camera tween。不得硬编码固定 zoom 或把动画完成时间当 navigation truth；settlement 与 Camera arrived 分开。

### Acceptance

- LOCAL/NEAR_EDGE/EDGE 连续且稳定；
- oversized target、multiple-node union 正确；
- Professional Window/Work View resize 后 cue 更新但 Camera 不跳；
- 用户手势可中断 travel；
- remote focus 先 settlement 后 arrival；
- missing projection/archive/project switch 清理状态。

完整蓝图：`C:\Users\1\Desktop\222\LCOS_Gen2_T2_C2-3A_Locator_CameraRequest_Arrival_ExactSourceBlueprint_20260907.md`。

## 6. Spatial Navigator

### Exact files

CURRENT：

```text
huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx
huabu/apps/web/src/store/canvasStore.ts
huabu/apps/web/src/components/Settings/sections/GeneralSettings.tsx
huabu/apps/web/src/components/Panels/CanvasLayerPanel/focusNodesOnCanvas.ts
huabu/apps/web/src/lcos-seam/types.ts
apps/web-gen2/src/integration/huabu/LcosCanvasAdapter.tsx
apps/web-gen2/src/host/hostSeam.ts
```

PLANNED：

```text
huabu/apps/web/src/lcos-seam/types.ts                    CanvasSpatialNavigatorControls
huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx neutral render-function slot
apps/web-gen2/src/integration/huabu/LcosCanvasAdapter.tsx
apps/web-gen2/src/host/hostSeam.ts
huabu/apps/web/src/lcos/useLcosCanvasProps.tsx
huabu/apps/web/src/lcos/ui/LcosSpatialNavigator.tsx
```

### State / event

不建新 store。Zoom 读 ReactFlow transform；Lock 读 Canvas controlled state；Minimap 复用 `canvasStore.minimapEnabled`；Fit 调 Huabu reliable bounds。Grid 为低频 presentation preference，未批准前不得持久化成 Core truth。

### Screen/world owner

Navigator 是 ReactFlow 内 screen-space HUD；MiniMap/world transform、Camera、bounds 都由 Huabu。必须在 `<ReactFlow>` context 内渲染，不得移到 Project Chrome 后用 callback 模拟。

### ProfessionalWindow collision

T4 safeRect/occupancy 只控制 Navigator placement。Work View resize 重新定位仪表，不自动 fit、不改 Camera。

### Motion responsibility

T5：仪表展开、按钮反馈、zoom readout transition。Huabu：zoom/reset/fit mechanics；100% reset 延续当前约 200ms 行为。性能降级时先停复杂装饰。

### Acceptance

- stock Huabu 未传 replacement 时行为不变；
- LCOS replacement 仍消费同一 Minimap/Lock state；
- Fit 不复制 bounds 算法；
- 没有第二 Camera/viewport/store；
- ProjectSession 切换后绑定当前 Canvas。

完整蓝图：[C2-3B Spatial Navigator](E:\OS开发\LCOS_Gen2\docs\handoffs\LCOS_Gen2_T2_C2-3B_SpatialNavigator_ExactSourceBlueprint_20260907.md)。

## 7. Railway receive / navigation

### Exact files

CURRENT substrate：

```text
packages/contracts/src/index.ts                          V0 ProjectViewRail* contract
apps/local-core/src/routes/projects.ts                    V0 rail route
apps/local-core/src/metadata-repository.ts                V0 order/CAS
apps/local-core/src/project-events/project-mutation-coordinator.ts receipt substrate
apps/local-core/src/mutation-safety-service.ts            ChangeSet substrate
packages/contracts/src/project-events.ts                  event substrate
huabu/packages/shared/src/types/api/space-move.ts
huabu/apps/server/src/modules/canvas/space-move.service.ts
huabu/apps/server/src/modules/canvas/canvas.route.ts
huabu/apps/web/src/api/canvas.ts
```

PLANNED：

```text
packages/contracts/src/railway.ts
apps/local-core/src/railway-destination-service.ts
apps/local-core/src/railway-receive-service.ts
apps/web-gen2/src/backend/railway.ts
apps/web-gen2/src/presentation/railway.ts
T3 SemanticTargetRef / SemanticTargetAdapter / target-based drop machine
T2 Railway body/hook/adapter in approved ProjectSession shell
```

### State / event

Rail item：active/available/unavailable/legacy/migratable。Receive outcome 必须保留 committed、waiting_input、conflict、rejected、outcome_unknown。计划事件 `railway.changed` 只在 canonical commit 后发布；missed event 走 replay/snapshot refetch。

### Screen/world owner

- Railway rail/body、hover、armed、receipt/recovery：screen-space；
- remote `surface_root/worksite/receiver` identity：Core resolver；
- source node selection与物理 geometry：Huabu；
- semantic receive 默认 preserve-source。

### ProfessionalWindow collision

Railway 与 Project chrome 受 T4 occupancy 管理；不可覆盖 Work View 操作区。Railway receipt/recovery 不应作为 world node overlay。窗口变化不触发 receive 或 Camera。

### Motion responsibility

T5：hover→receptive、armed、committing、accepted、waiting/recovery、unavailable。T3：交互时序与 trial-drag rollback。Huabu：仅显式 physical transfer 的空间变化。`outcome_unknown` 禁止播放成功收尾。

### Acceptance

- canonical stableKey，不用 DOM/label/canvasId 冒充；
- source-stay receive 不删除/移动 source projection；
- multi-selection 单 operation 原子提交；
- physical transfer 必须显式确认；
- conflict/waiting/unknown 不压成布尔成功失败；
- 三个 surface 加载各自现场状态；
- migration 不静默丢 legacy item。

完整蓝图：[C2-4A Railway Receive](E:\OS开发\LCOS_Gen2\docs\handoffs\LCOS_Gen2_T2_C2-4A_RailwayReceive_ExactSourceBlueprint_20260907.md)。

## 8. Worksite enter / active / back

### Exact files

CURRENT mechanics：

```text
huabu/apps/web/src/pages/CanvasPage/CanvasPage.tsx         loadCanvas/switchCanvas
huabu/apps/web/src/store/canvasStore.ts                   per-canvas state
huabu/apps/web/src/store/canvasSyncStore.ts               spatial realtime
apps/web-gen2/src/host/createLcosHostRuntime.ts            retarget/dispose
apps/web-gen2/src/spatial/surfacePort.ts                   surface identity
```

PLANNED：

```text
apps/web-gen2/src/spatial/worksiteNavigation.ts
huabu/apps/web/src/lcos/navigation/LcosNavigationProvider.tsx
huabu/apps/web/src/lcos/navigation/useLcosNavigation.ts
huabu/apps/web/src/lcos/navigation/LcosActiveProjectCanvasRoute.tsx
huabu/apps/web/src/lcos/navigation/LcosProjectChrome.tsx
huabu/apps/web/src/lcos/navigation/useLcosRailway.ts
```

T6 final Worksite contract、stable canvas binding、home/parent、lifecycle、working set、active/recent recovery：GAP。旧 `workspace-state-service.ts` / routes 不是 final enter owner。

### State / event

BACK_DISABLED、BACK_AVAILABLE、ENTER_PRESS、NAVIGATING、ARRIVING、ACTIVE、UNAVAILABLE、ARCHIVED、BROKEN_CANVAS、PROJECTION_DEGRADED、RECOVERY_DEGRADED。每 ProjectSession 一条内存 navigation stack；canonical active/recent recovery 由 T6 owner，而非浏览器临时栈。

### Screen/world owner

- enter/back/chrome 状态：screen-space；
- Canvas switch与每 canvas spatial state：Huabu；
- Worksite identity/home/parent/lifecycle：Core；
- Back 返回 session navigation parent/history，不等同 Scope parent。

### ProfessionalWindow collision

切换 Worksite 时 Professional Window 生命周期由 T4 policy 决定；T2 不自行保留/关闭。目标 Canvas settlement 后重算 safeRect；不从 Core 恢复 Camera。

### Motion responsibility

T5：press/navigating/arriving/active、不可用与降级呈现。Huabu：Canvas/Camera mechanics。不得用 motion completion 代替 actual/expected canvas settlement。

### Acceptance

- 连续 enter/back 顺序正确且去除相邻重复；
- reload/project resume 从 canonical owner恢复，不靠旧内存栈伪造；
- missing/archived/broken canvas fail closed；
- conversation child 只有已 materialize Worksite 才物理进入；
- browser back、pending save、reconcile failure 有明确状态；
- 每 Surface/Worksite 恢复自己的 Huabu spatial state。

完整蓝图：`C:\Users\1\Desktop\222\LCOS_Gen2_T2_C2-1D_Worksite_Enter_Active_Back_ExactSourceBlueprint_20260907.md`。

## 9. Remote identity / marker

### Exact files

CURRENT：

```text
apps/web-gen2/src/spatial/projectionBinding.ts
apps/web-gen2/src/backend/sqliteBindingStore.ts
apps/local-core/src/routes/spatial-bindings.ts
apps/local-core/src/navigation-marker-service.ts          legacy/current donor
packages/contracts/src/navigation-marker.ts               legacy/current donor
apps/web-gen2/src/host/projectionFacade.ts
```

PLANNED migration：

```text
T6 canonical destination resolver
typed target ref with lifecycle/availability
T2 occurrence/locator/railway visual projection
```

### State / event

统一 identity states：local-current、local-other-occurrence、remote-available、remote-unavailable、archived、missing、stale/degraded。Marker 不是独立导航 truth；它是 canonical target/occurrence 的 read projection。

### Screen/world owner

- remote marker/edge cue：screen-space；
- target-local mark：world object decoration，但 identity 来自 canonical ref + ProjectionBinding；
- marker service 不存 geometry；world→screen 由 Huabu。

### ProfessionalWindow collision

所有 edge/remote marker 必须以 T4 safeRect 为边界，并避开 Professional Window。遮挡变化只重排 marker；不改 canonical target，不自动 Camera pan。

### Motion responsibility

T5 建立一套跨 Focus、Pin、Locator、Railway 共用的远距 identity 视觉语法：形态/图标/边框/文案共同区分，不能只靠颜色。near-edge 可连续变化，unavailable/archived 不使用诱导性抵达动画。

### Acceptance

- 同一 canonical entity 多 occurrence 不串 identity；
- remote marker 可回到明确 destination；
- stale binding 触发 refetch/repair，不猜 canvas；
- archive/missing 不可点击成假成功；
- screen marker 与 world mark 同 identity、不同 owner；
- Project/canvas switch 清理旧 marker。

## 10. 跨 seam collision 规则

同一时刻 screen-space 元素优先级：

```text
Professional Window / active Work View interaction
→ modal / waiting_input / outcome_unknown
→ Search or Focus primary HUD
→ Railway / SurfaceDock chrome
→ Spatial Navigator
→ Locator / remote marker
→ transient Arrival cue
```

T4 是 occupancy/safeRect owner。T5 可定义排列与退化，不可创建第二 safeRect。空间不足时建议：

1. 保留交互中的 primary HUD；
2. Locator/marker 聚合；
3. Spatial Navigator 收紧为 compact；
4. Arrival cue 降为 target-local minimal；
5. 不通过自动 Camera 移动“解决”UI 碰撞。

## 11. 跨 seam motion 规则

- Camera tween 只有 Huabu 执行；
- navigation settlement、Camera arrived、canonical commit 是三个不同事件；
- 新 target、用户 Camera gesture、Project/canvas switch 必须取消旧 presentation token；
- `waiting_input/conflict/outcome_unknown` 不播放 accepted motion；
- 持续流动线最多两条，非 active/selected 不持续动画；
- reduced motion 下保留状态可读性，不依赖位移动画表达结果。

## 12. T5 可直接回填项

T5 现在可以输出：

- 每 seam 的 compact/expanded/blocked/recovery visual state；
- Professional Window 碰撞布局与退化顺序；
- Focus/Pin/Locator/Railway 共用 identity/marker grammar；
- enter/travel/arrive/settle/interrupt 的 motion tokens；
- Spatial Navigator 的 control hierarchy 与尺寸；
- Search results、occurrence chooser、Railway receipt 的键盘/无障碍状态；
- reduced-motion 等价表达。

T5 现在不能决定：

- Worksite/Receiver/Railway canonical schema；
- surface→canvas binding；
- Camera/viewport persistence；
- transaction/idempotency/compensation；
- screen/world geometry owner；
- ProjectSession/provider lifetime。

## 13. 依赖推进顺序

```text
ProjectSession active-project mount
→ T6 Worksite/destination identity
→ Search/Focus/Pin read presenters
→ T1 safeRect-capable spatial focus port
→ Locator/Arrival + Spatial Navigator
→ T3 remote-target semantic drop
→ T6 Railway source-stay transaction
→ Railway receive E2E
→ durable physical saga gate
```

## 14. 总验收

- 所有 seam 标注 CURRENT/PLANNED/GAP 与真实文件；
- screen/world/canonical owner 不重叠；
- Professional Window collision 有统一 safeRect owner；
- Camera motion 没有第二执行者；
- remote identity 跨 Focus/Pin/Locator/Railway 一致；
- Main/Context/Workflow 状态严格隔离；
- Project switch/reload/missed event/unknown outcome 均有恢复路径；
- T5 视觉稿不把 fixture、plan 或 mock 写成生产能力。
