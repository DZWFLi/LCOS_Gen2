# LCOS Gen2 · T2 C2-2 / C2-3A Current Baseline Rebase Audit

> 日期：2026-09-07  
> 原稿来源：`C:\Users\1\Desktop\222`  
> 旧源码基线：`LCOS_Gen2@c2ff890a867922a1256572199458438572eb0a8c`  
> 当前权威基线：`LCOS_Gen2@232b2ca5` + `Huabu@a3c411e1f655191344285141f08c4738fa6015f7`  
> 状态：REBASE AUDIT COMPLETE / ORIGINAL BLUEPRINTS NOT YET REWRITTEN / NO PRODUCTION PATCH

## 1. 审计对象

```text
LCOS_Gen2_T2_C2-2A_ProjectSearch_ExactSourceBlueprint_20260907.md
LCOS_Gen2_T2_C2-2B_Focus_Where_ExactSourceBlueprint_20260907.md
LCOS_Gen2_T2_C2-2C_ColorPin_ExactSourceBlueprint_20260907.md
LCOS_Gen2_T2_C2-2_SearchFocusColorPin_IntegrationCheckpoint_20260907.md
LCOS_Gen2_T2_C2-3A_Locator_CameraRequest_Arrival_ExactSourceBlueprint_20260907.md
```

## 2. 总结论

```text
C2-2A Search Core/backend truth        STILL VALID
C2-2B ProjectionBinding identity       STILL VALID
C2-2B Huabu bounds/focus mechanics     STILL VALID
C2-2C Color Pin Core truth             STILL VALID
C2-3A Locator/Arrival ownership        STILL VALID

Huabu/LCOS production composition      CHANGED / DISCONNECTED
Huabu cross-Space move capability      NEW REUSABLE ASSET
document baseline labels               STALE
```

不能只把原稿页眉 SHA 换掉。重基必须修正 composition fact，并把新 Space Move 资产送入 C2-4，而不是误塞进 C2-2/C2-3A。

## 3. `c2ff890 → 232b2ca5` 范围判断

Git delta 显示本次大部分变化来自 Huabu re-vendor 与 LCOS thin seam 重迁移。`apps/local-core`、`packages/contracts`、`apps/web-gen2` 的 Search、Color Pin、ProjectionBinding 主链没有在该区间被改写。

因此以下 current source 仍成立：

### Search

```text
apps/web-gen2/src/backend/search.ts
apps/local-core/src/routes/curation.ts
apps/local-core/src/project-search-service.ts
packages/contracts/src/search.ts
```

现状仍使用旧 occurrence vocabulary：

```text
workspace | scope | conversation
```

`locationRefs` 仍是 read projection，Project Search engine/ranking 不应重写。T6 exact Worksite/occurrence contract 仍是 migration dependency。

### ProjectionBinding / Focus identity

```text
apps/web-gen2/src/spatial/projectionBinding.ts
apps/web-gen2/src/backend/sqliteBindingStore.ts
apps/web-gen2/src/host/projectionFacade.ts
apps/local-core/src/routes/spatial-bindings.ts
```

`ProjectionBinding` 仍只承担 canonical entity ↔ Huabu spatial identity，不保存 geometry。C2-2B 禁止重新引入 `ArtifactView.position`、Workspace viewport/frame bounds 作为 Focus spatial truth。

### Color Pin

```text
packages/contracts/src/color-pin.ts
apps/local-core/src/routes/color-pins.ts
apps/local-core/src/mutation-safety-service.ts
```

definition + membership + ChangeSet 主链仍在；没有坐标 persistence。C2-2C 继续复用 Focus/Locate，不新增 Pin geometry/camera owner。

### Huabu bounds / Camera mechanics

```text
huabu/apps/web/src/components/Panels/CanvasLayerPanel/focusNodesOnCanvas.ts
```

以下符号在 current source 仍存在：

```text
anchorViewportCentre()
revealBoundsInViewport()
getReliableNodeBounds()
fitNodesOnCanvas()
focusNodesOnCanvas()
```

`getReliableNodeBounds()` 仍处理 `onlyRenderVisibleElements` 下未测量节点。C2-3A 不建立第二套 bounds/Camera mathematics。

## 4. 必须修正的 current composition fact

旧基线中：

```text
CenterArea
→ useLcosCanvasProps(PROJECT_ID ?? disposable-mvp-sample)
→ <Canvas {...lcosProps} />
```

当前 `232b2ca5`：

```text
CenterArea
→ <Canvas shortcutsDisabled={...} />

useLcosCanvasProps.tsx
→ 文件仍存在
→ current production call site = NONE
```

裁决：

- 不回退 Huabu vendor；
- 不恢复 `PROJECT_ID ?? disposable-mvp-sample` 旧入口；
- 不把 helper 文件存在写成 production 已接通；
- 由 C2-1A/T4 的 active-project route + ProjectSession topology 重新建立唯一正式 consumer；
- C2-2 Search/Focus/Pin 与 C2-3 Locator/Navigator 都挂同一个 ProjectSession lifetime。

这是一项 current integration gap，不是产品语义重开。

## 5. 新增 Huabu Space Move 资产

`a3c411e` 新增：

```text
huabu/packages/shared/src/types/api/space-move.ts
huabu/apps/server/src/modules/canvas/space-move-plan.ts
huabu/apps/server/src/modules/canvas/space-move.service.ts
huabu/apps/web/src/components/Panels/Canvas/MoveSelectionModal.tsx
canvasStore.moveSelectionDialogOpen
```

能力包括：

- existing/new destination；
- `expectedSourceVersion` stale guard；
- 多 Canvas mutex；
- hierarchy/frame descendants；
- internal edges preserve、boundary edges truthful omission；
- artifact clone/rewrite；
- conversation/thread move约束；
- source preview 可选；
- compensation/unknown outcome error family；
- destination label dedupe 与结果回执。

它是 C2-4 Railway Receive 的首选 Huabu mechanical donor，但不是 LCOS canonical semantic transaction owner。正确组合必须是：

```text
T3 typed Railway DropDestination
→ T6 canonical eligibility / semantic transaction
→ Huabu Space Move mechanics（仅在确实需要 spatial transfer 时）
→ Railway result/receipt presentation
```

禁止把 `MoveSelectionModal` 直接升级为 Railway 主 UX，也禁止绕过 T6 只移动 Huabu nodes。

## 6. 各原稿 rebase disposition

| 原稿 | 结论 | 必改项 |
|---|---|---|
| C2-2A Project Search | ACCEPT WITH REBASE | 新基线；production mount 状态；T6 vocabulary gate |
| C2-2B Focus/在哪 | ACCEPT WITH REBASE | 新基线；active-project consumer；T4 safeRect/resize gate |
| C2-2C Color Pin | ACCEPT WITH REBASE | 新基线；ProjectEvents subscriber/mount 状态 |
| C2-2 Integration | ACCEPT WITH REBASE | 统一 current mount gap；依赖状态 |
| C2-3A Locator/Camera/Arrival | ACCEPT WITH REBASE | 新基线；composition gap；T4 policy 尚未 landed |

## 7. 当前依赖状态

```text
WAIT_T4_IMPLEMENTATION
→ professionalWindowEnvironment.ts
→ safeRect/safeInsets/occupiedRects/activeRegions
→ viewportResizePolicy: preserve-transform

WAIT_T6_EXACT
→ Worksite/occurrence vocabulary
→ canonical destination/eligibility

WAIT_PROJECTSESSION_MOUNT
→ useLcosCanvasProps 或继任 provider 的唯一 production consumer

T5_BACKFILL
→ Locator/Arrival/Navigator final visual and motion
```

## 8. 下一步

1. 不改桌面原稿，保留其历史证据身份；
2. 在仓库 `docs/handoffs/` 产出 consolidated rebase addendum，而非复制五份超长旧稿；
3. C2-4 直接以 current `232b2ca5/a3c411e` 做 S10/S11/S12 census；
4. 把 Space Move 纳入 S10 donor matrix；
5. Production patch 继续锁定。

