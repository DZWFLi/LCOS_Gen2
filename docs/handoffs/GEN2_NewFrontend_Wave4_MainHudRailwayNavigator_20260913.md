# Wave 4 施工交付 — Main + Global HUD + Railway + Navigator

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 4

## 用户现在真实能做什么

这是第一轮可交给用户正式体验的前端切片：进入项目后整页就是 LCOS 整机——顶中导航岛（Cmd/Ctrl+F 展开、实时 Core 搜索、结果点击定位或给出位置语义）、左缘 Railway 三现场快速切换、底部 SurfaceDock、左下相机浮岛（+/-/适合画面/百分比，替代旧 Controls）、F 键「在哪」回答选中对象的位置。搜索、定位、切现场、刷新恢复全部走真实 Core/Huabu。

## Before → After

- Before（Wave 3）：Shell 只有身份胶囊 + 画布 + Dock；无搜索/无导航/无相机入口（旧 Controls/MiniMap 已被 chromeMode 隐藏但无替代）。
- After：Global HUD 三岛 + Railway + Navigator 搜索（Figma hud 5388:27696 语义：Navigator 顶 24 居中 hug 52→402、Railway 左 24、camera 左下 52、Dock 底 24）；相机命令走唯一 Huabu camera port；Search 与 Focus 分离（P10）；旧 `.react-flow__controls`/`.minimap` 确认仍不在 DOM（且有了 LCOS 替代）。

## Production caller

```text
LcosProjectShell → LcosGlobalHud
 ├─ LcosNavigatorIsland（Cmd/Ctrl+F → CoreSearchClient.searchProject → locateHit：同现场 projection → focusNodesOnCanvas；否则位置语义提示，不假定位）
 ├─ LcosRailway（CoreRailwayClient.read 真实 order；三现场 switchWorksite）
 ├─ LcosSurfaceDock → useLcosWorksiteNav（switch/创建+回写）
 ├─ LcosFocusWhere（F：选中实体 → 同现场 occurrences + search locationRefs 跨现场 → 前往）
Canvas overlays（canvas-local）：LcosCameraControls（命令 → 唯一 camera）+ LcosCanvasCommands（camera/locate 消费）
```

## 修改文件

- 新增：`lcos/shell/{LcosGlobalHud,LcosRailway}.tsx`、`lcos/navigation/{LcosNavigatorIsland,LcosFocusWhere,LcosCameraControls,LcosCanvasCommands}.tsx`、`lcos/app/useLcosWorksiteNav.ts`、`lcos/surfaces/main/MainWorksite.tsx`、`lcos/navigation/occurrenceRowLabelHost.ts`、`scripts/e2e/wave4-hud.mjs`。
- 修改：`lcos/shell/{lcosShellStore,LcosSurfaceDock,LcosProjectShell}.tsx`、`lcos/app/{useLcosWorksite,LcosProjectRoute}.tsx`、`lcos/useLcosCanvasProps.tsx`（新增两个 canvas-local overlay）、`apps/web-gen2/src/index.ts`（导出 occurrenceRowLabel/类型）。

## Donor/Figma 采用

- Figma hud 5388:27696 + NavigatorIsland 5384:367（静息 52 → 搜索 402 hug；彩色 pin Wave 4 只保留结构位，颜色组 Wave 9）+ Railway 5385:283（三目的地）+ ProjectShell 5386:436。
- GEN1 donor：`ProjectSearchLens` 的 resultFromRemote/anchorLabel 语义参考（A/B，host 用 Core 数据源重写）；`ProjectFocusNavigator` 去重标签用 `occurrenceRowLabel`（A，Wave 0 已救回）。
- 相机浮岛：GEN1 `CanvasGeometry` zoom 语义 + Figma HUD camera 左下 52（B 壳）。

## 真实数据路径

搜索「受控」→ GET /projects/lcos-gen2-dev/search → 命中「项目定位/施工纪律/当前里程碑」（真实 artifact）→ 点击已投影结果 → ReferenceStore 反查 nodeId → focusNodesOnCanvas 移相机（viewport transform 变化实测）。F 键 → 选中 glyph（connected-conversation-9）→ occurrences（同现场无重复投影，诚实显示）。

## 浏览器操作与截图（scripts/e2e/wave4-hud.mjs）

| 断言 | 结果 |
|---|---|
| HUD 四岛存在（Navigator/Railway×3/Dock/camera） | ✓ |
| 旧 Controls/MiniMap 缺位 | ✓ |
| Cmd+F 展开 52→402 + 输入 | ✓ |
| 真实搜索「受控」出结果（3+ 实体） | ✓ |
| 结果点击 → 相机移动（同现场已投影定位） | ✓ transform 变化实测 |
| F 键 → 在哪面板（实体 id + 无其它投影诚实态） | ✓ |
| 相机「放大」按钮 zoom 0.285→0.342 | ✓ |
| Console | 无本批错误 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| huabu typecheck | PASS |
| eslint src/lcos（max-warnings 0） | PASS |
| vitest src/lcos（12 文件） | PASS |
| web-gen2 typecheck（index 导出变化） | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- Navigator 彩色 Pin 组 / 画外 Locator / Locator 到达动画：Figma minimumGap，Wave 8/9。
- Railway reorder / Receive / +N 溢出：Wave 9（当前仅真实 order 读取并显示 +N 徽标）。
- 跨现场搜索结果直接 arrive：真实切换已可（Dock/Railway），arrival camera/焦点恢复 Wave 8（不假定位）。
- FocusWhere 的跨现场行已实现（search locationRefs → surface 映射 → 前往）；同现场无人工造重投影。
- 相机浮岛与 Navigator 岛的键盘焦点顺序：Wave 9 无障碍收口。

## 下一 Wave 的直接输入

- Wave 5 就绪：Assembly（`apps/web-gen2/src/backend/assembly.ts` + `lcos/assembly` 控制器 + `AssemblyBody`）+ Reader（GEN1 artifactViewerRegistry 思路 + Huabu Preview 机械）+ Composer（commandDraft/composerController 纯逻辑 + ReceiverComposerBody）挂 ProfessionalWindowStage 与 Dock 的 Assembly 入口。
- 材料：`AssemblySourceBayController`/`assemblyCardView`/`professionalWindowLayout`/`conversationWorkViewController` 已在 Wave 0 救回（web-gen2），只等 host 壳。

## 回滚点

Wave 3 commit 之后；HUD 组件均在 `lcos/` 内部，撤除只需 Shell 一处挂载 diff；相机浮岛 overlay 移除即恢复无相机入口状态（旧 Controls 仍在 chromeMode 后门）。