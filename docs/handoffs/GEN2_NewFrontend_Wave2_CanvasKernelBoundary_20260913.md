# Wave 2 施工交付 — Huabu Canvas Kernel Boundary 与旧 chrome 退役

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 2

## 用户现在真实能做什么

在 LCOS 项目 Shell 里，画布只剩纯空间机械：拖节点、缩放（ctrl+wheel / 触摸 pinch）、中键平移、单选、多选（Shift 增选；框选依赖真实鼠标，见下）、拖拽后 reload 几何保持——与 Huabu 原内核行为一致，但 Huabu 产品 chrome（底部创建工具栏、左下缩放控件、Minimap）不再出现在 LCOS 界面。LCOS 相机入口（Figma HUD 左下 52）由 Wave 4 提供。

## Before → After

- Before：Canvas 永远挂 NodeToolbar（底中）、Controls（左下）、MiniMap（右下）+ LCOS overlay 叠在旧壳上。
- After：`<Canvas chromeMode="lcos">` 显式隐藏三类产品 chrome（命令路径保留）；LCOS route 改由唯一 `CanvasHostBoundary`（单 runtime 会话 + retarget + reconcile 'project-open'）装配 Canvas；运行时 host 经 `lcosHostState` store 响应式透传（retarget 后不冻结）。
- 生产组合树唯一性保持：仅一份 ReactFlow / selection / camera / history。

## Production caller

```text
LcosProjectShell → LcosWorksiteStage → CanvasHostBoundary(projectId, chromeMode='lcos')
  → useLcosCanvasProps(projectId)   （createLcosRuntime 单实例 / retarget / reconcile / reference index）
  → hostExtension（overlay + recognizers + connectIntent + resolveNodeBody seam）
  → <Canvas chromeMode chromeExtension />
```

## 修改文件

- `huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx`：新增 `chromeMode?: 'huabu'|'lcos'`；lcos 模式不挂 NodeToolbar/Controls/MiniMap（kernel 事件不关）。
- `lcos/host/`：新增 `CanvasHostBoundary.tsx`、`lcosHostState.ts`（机制收编自 archive c47a1b4）、`useLcosHost.ts`、`lcosNativeChromePolicy.ts` + test。
- `lcos/useLcosCanvasProps.tsx`：runtime 创建 / retarget / 卸载时同步 `lcosHostStore`。
- `lcos/shell/LcosWorksiteStage.tsx`：改挂 `CanvasHostBoundary`（并传 projectId）。
- `docs/construction/HUABU_RETIREMENT_LEDGER.md`：NodeToolbar/Controls/MiniMap 行更新为 Wave 2 ✓。

## Donor/Figma 采用

- 机制：archive c47a1b4 `lcosHostState`（overlay host 跟随 retarget）；Canvas Host seam 契约保持（lcos-seam/types.ts resolveNodeBody）。
- Figma：HUD 面 camera 左下 52 控制留待 Wave 4（本轮仅为 chrome 退役，不引入视觉）。

## 真实数据路径

同 Wave 1（lcos-gen2-dev → Main canvas → Huabu /api 加载 31~32 个真实节点）；runtime reconcile 'project-open' 后 reference index 同步（既有机制）。

## 浏览器操作与截图（scripts/e2e/wave2-*.mjs）

| 断言 | 结果 |
|---|---|
| react-flow 存在 | ✓ |
| LCOS mode 下 Controls / MiniMap 缺位 | ✓ |
| NodeToolbar 无文本残留（仅 xyflow attribution "React Flow" 保留=许可证义务） | ✓ |
| 点击选中节点（.selected） | ✓ |
| 拖节点 transform 变化（-601,-36 → -280,130） | ✓ |
| ctrl+wheel 缩放 scale 0.285→0.327 | ✓ |
| 中键平移 viewport 变化 | ✓ |
| reload 后画布(32 节点)恢复 + chrome 仍隐藏 | ✓ |
| 框选（左键拖空区）headless 不可复现；同 Canvas 在旧 Huabu `/canvas/:id` 路由行为一致（parity ✓）→ 非本波回归；真实鼠标手感待 Wave 9 人工/录屏验收 | 记载 |
| Console | 无本批错误 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| `npm run typecheck`（huabu web） | PASS |
| `npx vitest run src/lcos/host/lcosNativeChromePolicy.test.ts` | PASS |
| `npx eslint src/lcos/host` | PASS |
| web-gen2 / local-core 回归 | 不受影响（无 diff） |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- LCOS camera controls（Figma HUD 左下 52）→ Wave 4。
- 框选/套索 真实鼠标手感 → Wave 9 录屏验收；headless 合成手势无法稳定复现（old/new parity 一致，kernel 未动）。
- `resolveNodeBody` seam：机制已通电（Context Provider 已在 Canvas），Wave 3 提供全物种 resolver。
- undo/redo：canvasStore 既有 80+ 单测覆盖，浏览器快捷键验证并入 Wave 9 键盘路径。

## 下一 Wave 的直接输入

- Wave 3 节点呈现 junction 就绪：`NodeBodyResolverContext` 已挂（Canvas.tsx）；`CanvasNodeBodySeam{resolve,subscribe}` 类型已恢复；runtime seam 待接 `resolveNodeBody`。
- 输入：`apps/web-gen2/src/presentation/{visualFamily,rendererRegistry,nodePresentation}.ts` + `createNodeBodyResolver` 骨架重建 + GEN1 `CanvasNodeVisual` 内容分流（nodeSpecies）+ Figma Main/集合物种。

## 回滚点

Wave 1 commit 之后；Canvas chrome 显隐为 `chromeMode` 一处开关，回滚即恢复 huabu 模式；runtime/状态透传在 `lcos/` 内独立可撤。