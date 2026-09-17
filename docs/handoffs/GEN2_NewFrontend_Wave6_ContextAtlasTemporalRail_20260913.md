# Wave 6 施工交付 — Context + Atlas + Temporal Rail

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 6

## 用户现在真实能做什么

Context 现场不再只是改名画布：右侧有局部时间轨（Temporal Rail 骨架），左下 Atlas 入口可呼出 Context 强表征——8 张真实体块（3 现场 + 5 会话，真实名称/日期），事情/时间两种组织方式切换（时间=真实 updatedAt 排序），点卡片「进入」走真实 worksite/保持现场语义，关闭后回到原画布（camera 未动）。

## Before → After

- Before（Wave 5）：Context 现场 = 通用 WorksiteStage，无 Context 专属仪器。
- After：ContextWorksite（Atlas 强表征 + Temporal Rail 局部轨 + 现场仪器入口）；Atlas 数据 = 真实 warehouse（scene/conversation）；不再 overlay 全局。

## Production caller

```text
LcosProjectShell → ContextWorksite（context surface）
 ├─ ContextAtlasStage：CoreAssemblyClient.getWarehouse（scene/conversation/collection/workflow）→ 事情/时间分组 → 进入（scene→switchWorksite；其余保持现场）
 └─ TemporalRail：右 24 宽 65 骨架（时间分组 producer Wave 8 绑定；不画虚假刻度）
```

## 修改文件

- 新增：`lcos/surfaces/context/{ContextWorksite,ContextAtlasStage,TemporalRail}.tsx`、`scripts/e2e/wave6-context.mjs`。
- 修改：`lcos/shell/LcosProjectShell.tsx`（context → ContextWorksite）。

## Donor/Figma 采用

- Figma context 5388:21602 / atlas 5388:24294 / 集合 5333:96（事情/时间 × 总览变体）临时按 2.5D 卡片 + 分组实现；temporal 5388:25701（右 24 宽 65 maxH 555 骨架）。
- GEN1：ContextSpaceSurface 布局思路（B）；child Portal/approach/restore 与 Atlas 连续动效 Wave 8/9。

## 真实数据路径

`GET /projects/lcos-gen2-dev/warehouse` → 8 项（scene×3/conversation×5）→ Atlas 事情按 kind 分组 / 时间按 updatedAt 排序 → 进入/关闭。

## 浏览器操作与截图（scripts/e2e/wave6-context.mjs）

| 断言 | 结果 |
|---|---|
| Context worksite + stage=context + canvas 存活 | ✓ |
| TemporalRail 右侧出现 | ✓ |
| Atlas 打开 → 8 张真实体块（scene/conversation） | ✓ |
| 时间组织 → 最近更新 | ✓ |
| 关闭 → Atlas 消失、原画布恢复 | ✓ |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu typecheck | PASS |
| eslint src/lcos（v0 warn） | PASS |
| vitest src/lcos（12 文件） | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- child worksite 进入/返回的对象身份 + camera restore（Portal/Surface）+ Atlas 立体/光幕连续动效：Wave 8/9（T6 producer 绑定）。
- Temporal Rail Episode 聚合 / hover 鱼眼 / wheel 窗口：producer（Run/事件时间分组）Wave 8 绑定后实现；当前空态骨架不伪造刻度。
- Collection 拆/合/删除 真实动作：依赖 Core 集合 route（Wave 8 核对）。

## 下一 Wave 的直接输入

- Wave 7 Workflow 就绪：WorkflowWorksite + Card 物种（Figma 卡 5335:110 7 状态；3:4 224×324）+ Card Pool/Hand；材料 Drop 到 Step/引用草稿（加入 Composer）已有 addEntityToDraft 通道；Run/Review 状态 projection 复用 Assembly/Run 客户端。

## 回滚点

Wave 5 commit 之后；Context 仪器为 `lcos/surfaces/context/*` 独立文件，Shell 一处挂载撤除即回。
