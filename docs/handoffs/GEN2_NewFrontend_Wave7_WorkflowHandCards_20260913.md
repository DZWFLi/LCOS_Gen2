# Wave 7 施工交付 — Workflow Worksite / Hand / Card Pool

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 7

## 用户现在真实能做什么

Workflow 现场有自己的行动壳：左下「手牌 · 卡池」呼出卡池（8 张真实材料/会话卡，3:4 竖卡物种，分类 + 搜索），「取用」把材料加入无线 Composer 草稿（明确未发送，改由一步真实提交）；画布恢复路径真实可用——工作流画布引用缺失时（seeded stale canvasId）显示「重新建立现场画布（回写 workspace）」，一键重建并回写。

## Before → After

- Before：Workflow 现场 = 通用画布；无手牌/卡池/卡物种；画布 404 只能重试。
- After：WorkflowWorksite（手牌 + Card Pool）+ 3:4 任务卡物种（Figma 5335:110 取用卡语言）+ canvas 失效恢复（重建+回写，真实 createCanvas/updateWorkspaceCanvasId）。

## Production caller

```text
LcosProjectShell → WorkflowWorksite → LcosWorksiteStage
 └─ WorkflowCardPool：CoreAssemblyClient.getWarehouse（artifact/conversation/workflow）→ 取用 → addEntityToDraft（Composer）
WorksiteStage canvasNotFound → ensureCanvas(force) 恢复（WorksiteStage/worksite force 参数贯通）
```

## 修改文件

- 新增：`lcos/surfaces/workflow/{WorkflowWorksite,WorkflowCardPool}.tsx`、`scripts/e2e/wave7-workflow.mjs`。
- 修改：`lcos/shell/{LcosProjectShell,LcosWorksiteStage}.tsx`、`lcos/app/useLcosWorksite.ts`（force 恢复）、`lcos/surfaces/{main,context}`（ensureCanvas 签名）。
- 真实修复：工作流 seeded canvasId（canvas-lcos-workflow）指向已删除画布 → 新增「重建画布回写」恢复路径（浏览器实测触发一次后即修复）。

## Donor/Figma 采用

- Figma workflow 5388:22998 / 取用卡 5335:110（3:4 竖卡 7 状态，Wave 7 实现静息/取用动作位）；Assembly 卡物种语言。
- GEN1：WorkflowSurface/Cards 数据流参考（B）。

## 真实数据路径

warehouse（conversation×5 + artifact×3 + workflow×0）→ 卡池 8 张 → 取用 → draft.orderedEntityRefs → Composer strip（connected-conver…）。

## 浏览器操作与截图（scripts/e2e/wave7-workflow.mjs）

| 断言 | 结果 |
|---|---|
| 现场 stage=workflow + canvas 存活 | ✓（恢复路径首次触发后画布建立） |
| 手牌卡池 8 张真实卡（3:4） | ✓ |
| 取用 → Composer 草稿 strip | ✓（真实 DOM click 验证；Playwright force-click 对 absolute 容器为合成事件怪癖） |
| canvas 失效恢复按钮 + 回写 | ✓ 浏览器实测 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu typecheck | PASS |
| eslint src/lcos（v0 warn） | PASS |
| vitest src/lcos（12 文件） | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- 「打开/续接」卡动作：Run/Step 执行 Wave 8（当前标注 Wave 8，不伪造）。
- 手牌扇形/光幕动效、卡密度响应式：Wave 9。
- workflow 实体当前 warehouse 为 0（真实空态），材料池由 artifact/conversation 承担。

## 下一 Wave 的直接输入

- Wave 8 就绪：Glyph 双击打开 Conversation Work View（registry conversation 占位已设）；挂 Waiting/Recovery section（CoreRunClient.getPendingInputRequest / continuation clients 已救回）；T7 capability 门控（provider-capability contract 已恢复；Huabu Agentlet transport 就位但未配置 spawn → 诚实 unavailable）。

## 回滚点

Wave 6 commit 之后；Workflow 现场为独立文件，Shell 一处挂载可撤；恢复路径在 WorksiteStage 内（force 参数向后兼容）。