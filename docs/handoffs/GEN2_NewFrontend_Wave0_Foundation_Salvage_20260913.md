# Wave 0 施工交付 — 干净地基与选择性救援

日期：2026-09-13　分支：frontend-reconstruction-v2（基线 main@63188c2）
对应卡：`04_逐Wave施工卡与验收.md` Wave 0 + `02_基线与选择性救援清单.md`

## 用户现在真实能做什么

无可见 UI 变化（本波是管线迁移）。用户能获得的是：后端/契约/纯逻辑地基在新分支真实可追踪、可测试、可继续施工；旧 overlay UI 完全没有被带进来。

## Before → After

- Before（main@63188c2）：`apps/web-gen2` 只有 14 个模块；local-core 无 continuation/worksite/transport 能力；Huabu 无 node body seam；nodes 全部 native。
- After：contracts 增 8 个边界；local-core 增 continuation journal/receipt/service、work-view 投影、real Agentlet Gateway transport（compose real mode）、worksite stable canvasId（schema v54）；web-gen2 增 backend clients、composer/controller、locator/arrival/occurrence 纯逻辑；Huabu 增 `CanvasNodeBodySeam{resolve,subscribe}` reactive seam（NoteNode/Canvas 接线）；voiceInput 纯逻辑。
- 没有批量恢复 `huabu/apps/web/src/lcos/**/*.tsx`（旧 UI）。

## Production caller

本波不接任何 production caller（除既有 main 路径）。恢复的 seam/contract 是 Wave 1–3 的输入。

## 修改文件

- 新建 docs/construction/{PROJECT_READBACK,SOURCE_ADOPTION_LEDGER,FIGMA_SOURCE_LEDGER,HUABU_RETIREMENT_LEDGER}.md
- 恢复（git restore --source）：packages/contracts 8 文件；apps/local-core 16+ 文件（continuation/service/routes/compose/agentlet 等）；apps/web-gen2 30+ 文件（backend/composer/interaction/navigation/lcos/windows）；Huabu 4 文件（NoteNode/Canvas/nodeBodySlot/types）+ voiceInput+test；web-gen2 index.ts 追加 locator 导出
- 新增：apps/web-gen2/src/navigation/occurrenceLabel.ts + test
- 对齐修复（旧测试常量 vs 恢复 schema v54）：metadata-repository.test.ts SCHEMA_VERSION 50→54；conversation-continuation-service.test.ts v52→v54 fixture+断言；projection-bindings.test.ts v53→54

## Donor/Figma 采用

本波无新视觉组件；采用清单见 SOURCE_ADOPTION_LEDGER（九面状态分列，全 NEEDS_SOURCE_BINDING）。

## 真实数据路径

- schema v54 迁移链：v52 数据库 → v53 journal → v54 workspaces.canvas_id；迁移后 journal CRUD 可用（测试实测）。
- worksite canvasId：CoreProjectClient.createWorkspaceCanvas → metadata-repository workspaces.canvas_id（96d5f4a/c40b288 路径）。

## 浏览器操作与截图

无（API/contract 级验证；按 04 卡 Wave 0 定义「只测 API/contract」）。

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| npm run typecheck:web-gen2 | PASS |
| npm run test:web-gen2 | 221/221 PASS（含 locator/arrival/occurrence 新测试） |
| npm run lint+typecheck --workspace local-core | PASS |
| npm run build --workspace @local-creative-os/local-core | PASS |
| local-core vitest | 128/142（14 文件失败=main 基线预存环境失败：skills 目录缺失/vector/CLI/curator e2e/title-policy；**main 同环境 67 文件失败**，本波修复了 3 个恢复相关的版本偏移测试） |
| huabu web tsc --noEmit | PASS |
| huabu web vitest | 170/171 PASS（1 失败=blockFingerprintParity Milkdown 环境项，与 seam 无关） |
| huabu web vite build | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- 未恢复 archive overlay React tree、旧 token 壳、title-only Assembly、孤立 Waiting/Recovery（按 02 禁救清单）。
- 未恢复 `createNodeBodyResolver` 狭窄 conversation-only 逻辑；Wave 3 以全物种 resolver 重建。
- g10-glyph-projection.test.ts 对象在仓库无法定位（archive 自身不一致），Wave 3 重建对应投影测试。
- local-core 14 失败文件 = 环境/预存，已登记证据（main 基线同失败）。

## 下一 Wave 的直接输入

- Wave 1 材料就绪：`App.tsx` router（/projects、/projects/:projectId/:surface?）、LcosProjectLauncherPage、LcosProjectRoute、LcosProjectShell、lcosShellStore；projectId 只来自 Core route，不猜。
- 复用的 read 输入：CoreProjectClient（list/create + getProjectGraph + worksite canvasId）、Canvas.tsx/CenterArea.tsx 的挂载方式、web-gen2 lcosHost.ts 的 runtime config。

## 回滚点

`e2c39d9`（docs）/ `dbd5027`（foundation）之前即 main@63188c2。均本地提交，未 push。
