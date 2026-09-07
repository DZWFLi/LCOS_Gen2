# LCOS Gen2 · T2「222」对话接管与颗粒度审计

> 日期：2026-09-07  
> 基线：`LCOS_Gen2/main@232b2ca5` + `Huabu@a3c411e1f655191344285141f08c4738fa6015f7`  
> 状态：接管完成；规划继续；Production patch 锁定

## 1. 接管结论

「222」对话的有效进度已经恢复：

```text
C2-0A/B/C                         CLOSED
C2-1A/B/C/D                       BLUEPRINT COMPLETE（旧对话声明）
C2-2A Project Search              BLUEPRINT RECOVERED / REBASE REQUIRED
C2-2B Focus / 在哪                BLUEPRINT RECOVERED / REBASE REQUIRED
C2-2C Color Pin                   BLUEPRINT RECOVERED / REBASE REQUIRED
C2-2 Integration                  BLUEPRINT RECOVERED / REBASE REQUIRED
C2-3A Locator/Camera/Arrival      BLUEPRINT RECOVERED / REBASE REQUIRED
C2-3B Spatial Navigator           v2 EXACT BLUEPRINT ON DISK
C2-4 S10/S11/S12                  NEXT
Production patch                 LOCKED
```

原稿已于本轮从 `C:\Users\1\Desktop\222` 恢复。后续交付前必须完成 `c2ff890/58339e2 → 232b2ca5/a3c411e` current-source rebase，不能只替换页眉 SHA。

## 2. C2-3B 颗粒度判断

初稿只够架构评审，不够直接施工，原因是 `ReactNode` slot 没有关闭 Lock/Fit/Minimap owner 的适配问题。

已升级的 v2 现在包含：

- exact baseline；
- current file/symbol census；
- render-function neutral seam；
- state/action owner 表；
- Canvas 内 context bridge；
- exact JSX replacement 区；
- Gen2 mirror 与 production composition root；
- exact candidate files；
- exact unit/integration/browser cases；
- schema impact、风险、回滚与依赖。

结论：

```text
架构评审颗粒度     PASS
源码施工卡颗粒度   PASS WITH DEPENDENCY GATES
直接生产落码       NOT AUTHORIZED
```

依赖 Gate：

```text
T4 professionalWindowEnvironment.ts 未落 current source
→ safeRect placement 只能引用 exact planned contract

T4 viewportResizePolicy 未落 current source
→ preserve-transform 仍为 WAIT_T4_IMPLEMENTATION

T5 final navigator visual parameters
→ T5_BACKFILL，不阻塞 owner/seam
```

## 3. 已核实本地资料

已找到并纳入审计：

- Phase B 四路合并最终跨线程裁决稿；
- T2 C1 Consolidated ExactFile Source Construction Plan；
- T2 → T5 Engineering Seams Visual Input Pack；
- T4 C1 最终施工总方案与 C1-1/C1-2 exact plans；
- T5 39 号 Huabu `a3c411e` baseline alignment；
- Phase D Navigation/Glyph/Motion 正本；
- 节点呈现宪法；
- 当前 `LCOS_Gen2/main@232b2ca5` vendored source。

三套源码位置：

```text
Gen2   E:\OS开发\LCOS_Gen2
Huabu  E:\OS开发\Huabu（只读 upstream 参照）
Gen1   E:\OS开发 下历史仓库/包；施工时以 GitHub exact commit 为准
```

## 4. 恢复资料与剩余缺口

已从 `C:\Users\1\Desktop\222` 找回：

```text
LCOS_Gen2_T2_C2-2A_ProjectSearch_ExactSourceBlueprint_20260907.md
LCOS_Gen2_T2_C2-2B_Focus_Where_ExactSourceBlueprint_20260907.md
LCOS_Gen2_T2_C2-2C_ColorPin_ExactSourceBlueprint_20260907.md
C2-2 Integration 正式稿
C2-3A Locator_Camera_Arrival Exact Source Blueprint
```

同时找回 C2-0C、C2-1A/B/C/D、C2-2 checkpoint 与 integration checkpoint，共 11 份 Markdown。

这些文件的当前问题不是缺失，而是基线落后：

```text
多数 Exact Blueprint 显式基线 = Gen2@c2ff890
部分 checkpoint current vendored pin = Huabu@58339e2
当前权威基线 = Gen2@232b2ca5 + Huabu@a3c411e
```

因此状态统一为 `RECOVERED / REBASE REQUIRED`。不得批量字符串替换后冒充重基完成；每份必须复核 current file、symbol、owner、consumer 与 thin seam migration delta。

当前不再有阻塞 C2 继续规划的资料缺口。若后续 exact-source census 发现 T3/T6 最新 typed export 尚未落盘，再单独列依赖，不自行造类型。

## 5. 下一阶段

下一阶段固定为：

```text
C2-4A / S10 Railway Receive Map
→ T3 typed DropDestination
→ T6 eligible destination / semantic transaction
→ Huabu cross-canvas transfer mechanics
→ Railway destination presentation

C2-4B / S11 Receiver
→ Core Receiver identity/status/event
→ current conversation presence
→ Railway bottom presence/status

C2-4C / S12 Navigation More
→ low-frequency navigation management
→ feature-owner callbacks
→ no second navigation state
```

开工顺序：

1. 重基 C1 S10–S12 到 `232b2ca5/a3c411e`；
2. 做 current owner/producer/consumer/persistence/realtime/legacy census；
3. 对账 T3/T6 最新 exact exports；
4. 分别输出 C2-4A/B/C exact blueprints；
5. 输出 C2-4 integration 与总 dependency ledger；
6. 保持 production patch 锁定，等待明确批准。

## 6. 本轮文件结果

新增/完善：

- `docs/handoffs/LCOS_Gen2_T2_C2-3B_SpatialNavigator_ExactSourceBlueprint_20260907.md`
- `docs/handoffs/LCOS_Gen2_T2_222_Takeover_GranularityAudit_20260907.md`

未修改：

- `huabu/` 源码；
- `HUABU_UPSTREAM.md`；
- package/lockfile；
- Git history。
