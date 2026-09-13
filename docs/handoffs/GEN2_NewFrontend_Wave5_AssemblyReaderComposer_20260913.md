# Wave 5 施工交付 — Assembly + Reader + Composer

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 5

## 用户现在真实能做什么

底部 Dock 的 Assembly 可打开专业窗口，看到项目仓库 11 项真实材料（scene/conversation/artifact 分类卡片，瀑布流网格 + 页内搜索）；卡片可「加入 Composer 草稿」（引用 strip 实时出现）、「阅读」（打开 Reader）、「投放 Main」（POST /assembly/apply 真实回执逐项显示，含 changeSetId）。底部 Composer 常驻：显式引用 strip + Cmd/Ctrl+Enter 提交真实 Run；失败如实显示并保留草稿（本环境提交遇 FK 约束，诚实报错未伪装成功）。

## Before → After

- Before：Assembly 是禁用按钮（GAP），Composer 无入口，Reader 无宿主；Wave 5 无专业窗口层。
- After：route-level ProfessionalWindowStage（Figma window 5388:27165 / Chrome 5387:331 顶栏 + tab）+ body registry（assembly/reader 真实；conversation/runtime-doctor/capture/connector Wave 8 占位）+ 统一 Composer（reference store draft + CoreRunClient）。

## Production caller

```text
LcosProjectShell → ProfessionalWindowStage（route-level sibling）
 ├─ AssemblyBody：CoreAssemblyClient.getWarehouse → 卡片 → apply（POST /assembly/apply 逐项回执）
 ├─ ArtifactReaderBody：CoreArtifactClient.getArtifactDetail + revisions（正文通道 Wave 9）
 └─ （后续 body：conversation/runtime-doctor/capture/connector）
LcosProjectShell → LcosComposerHost：reference store draft（addEntityToDraft）→ CoreRunClient.createRun
```

## 修改文件

- 新增：`lcos/professional/{ProfessionalWindowStage,AssemblyBody,ArtifactReaderBody}.tsx`、`lcos/composer/LcosComposerHost.tsx`、`scripts/e2e/wave5-assembly-composer.mjs`。
- 修改：`lcos/shell/{lcosShellStore（windows 窗口拓扑）,LcosSurfaceDock（Assembly 启用）,LcosProjectShell}.tsx`、`lcos/lcosReferenceState.ts（addEntityToDraft）`、`apps/web-gen2/src/backend/assembly.ts（apply typed）`。

## Donor/Figma 采用

- Figma window 5388:27165/Chrome 5387:331（顶栏 title/tab/close）、Assembly 瀑布流（Lovart 先行）、Reader 5388:27411（双组正文降级）。
- GEN1：`AssemblyCaptureWorkspace/ProjectWarehouse` 数据流参考（B/C）；`commandDraft`/reference 语义（A）。

## 真实数据路径

warehouse GET（11 项）→ 草稿 → draft.orderedEntityRefs → Composer strip → createRun POST（本环境 409 FK，诚实失败保留草稿）；apply POST → 回执（applied/skipped/failed + channel + changeSetId）。

## 浏览器操作与截图（scripts/e2e/wave5-assembly-composer.mjs）

| 断言 | 结果 |
|---|---|
| Assembly 窗口打开 + 11 项真实卡片 | ✓ |
| 加入草稿 → Composer ref strip | ✓ |
| 提交 → 真实错误回执 + 草稿保留（FK 409） | ✓ 诚实失败 |
| Reader 打开（本环境 artifact 详情 404 → 诚实错误态） | ✓（error state） |
| 修复：Composer 与 Dock 重叠（真实 UI bug）→ 抬高到 dock 上方 | ✓ |
| 修复：窗口 width NaN → min() | ✓ |
| Console 404/409 均来自真实数据缺口（非代码错误） | 记录 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu typecheck | PASS |
| eslint src/lcos（v0 warn） | PASS |
| vitest src/lcos（12 文件） | PASS |
| web-gen2 typecheck（assembly.apply） | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- Reader 正文内嵌预览：Revision 内容通道 Wave 9（当前诚实元数据 + 外部打开）。
- Conversation Work View / RuntimeDoctor / CaptureInbox / ConnectorSource body：Wave 8 注册（当前占位文案）。
- Assembly drop→canvas 的 placement 联合（T3 semantic drop canonical commit）：apply 已接（place 可选），节点落位联调 Wave 8/10。
- Composer 键盘/无障碍/voice：Wave 9 收口（Cmd/Ctrl+Enter 已用）。

## 下一 Wave 的直接输入

- Wave 6 Context 就绪：ContextWorksite + Atlas（Figma 5333:96 六变体）+ Portal（5348:1151）+ Temporal Rail（5156:504/1871/3249）；archive 的 `ContextSpaceSurface/layoutV3` 纯布局已可在 donor 层复用；runtime host 就绪（useLcosHost）。

## 回滚点

Wave 4 commit 之后；Stage/Composer 均为 `lcos/` 内独立文件，撤除即回 Wave 4 形态；窗口拓扑在 shellStore（可清空）。