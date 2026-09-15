# GEN2 T2/T5 Railway 具体目的地进入施工交付

日期：2026-09-15
范围：T2 导航抵达、T5 全局 HUD 入口
状态：本地已修改，未提交，未 push

## 结论

Railway 不再只是 Core 顺序的禁用图标。对 Core 中能够唯一解析到 Workspace 和 Surface 的 `scene`、`context`、`workflow` 目的地，现在会携带确切 `workspaceId`，从 Railway 进入对应 child worksite；底部 SurfaceDock 仍只负责 Main/Context/Workflow 一级切换。

集合目的地仍保持不可用状态，因为当前没有完整的 Collection → Portal/Receiver 进入闭环。没有用猜测替代缺失能力。

## 变更前流程

```text
Core orderedRefs
  → Railway projection
  → 大多数具体目的地 forced disabled
  → 点击只能切 root Surface 或无动作
```

## 变更后流程

```text
Core orderedRefs + ProjectGraph(workspaces/scopes)
  → 唯一解析 workspaceId + surface
  → Railway 显示真实可用目的地
  → ensureWorkspaceCanvas(workspaceId)
  → Huabu 唯一 canvas kernel switchCanvas(canvasId)
  → /projects/:projectId/:surface?workspaceId=...
  → child worksite 精确加载
```

## 用户操作变化

- 点击 Railway 的具体现场、Context 或 Workflow 目的地，会进入对应 child workspace。
- 进入时不再把 child 误当成该 Surface 的根现场。
- 进入期间会暂时禁用 Railway 其它条目，防止共享 Canvas kernel 被并发切换。
- 目标 Canvas 读取失败时保留当前现场，并在 Railway 脚注显示真实失败原因。
- 底部三个 Surface 按钮的职责没有变化。

## 数据流与实现落点

- `railwayProjection.ts` 增加可选 `workspaceId`，仅在目标唯一解析时设置。
- root workspace 过滤改为依据 `scope.kind === 'root'`，避免把所有已映射到 Surface 的 child workspace 错误过滤掉。
- `LcosRailway` 选中态按精确 `activeWorkspaceId` 判断，避免同一 Surface 下多个 child 同时高亮。
- `LcosGlobalHud` 对 child 目的地调用现有 `ensureWorkspaceCanvas`、Huabu `switchCanvas` 和 React Router；没有新增 store、Canvas 或 runtime。
- `LcosProjectShell` 透传 `ensureWorkspaceCanvas` 给 Global HUD。

## 修改文件

- `huabu/apps/web/src/lcos/navigation/railwayProjection.ts`
- `huabu/apps/web/src/lcos/navigation/railwayProjection.test.ts`
- `huabu/apps/web/src/lcos/shell/LcosRailway.tsx`
- `huabu/apps/web/src/lcos/shell/LcosGlobalHud.tsx`
- `huabu/apps/web/src/lcos/shell/LcosProjectShell.tsx`

## 验证

- Railway projection：5/5 tests 通过。
- Huabu web TypeScript：通过。
- 本批修改文件 ESLint：通过。
- Huabu web production build：通过。
- Build 仍报告既有 CSS `::highlight`、lottie `eval` 与大 chunk 警告，非本批引入。
- `pnpm` 当前 shell 使用 11.5.2，而仓库声明 10.34.3；本轮测试使用仓库现有 `node_modules/.bin` 直接执行，未改 lockfile。

## 尚未完成

- Railway Receive、拖动重排、溢出菜单、hover 预览。
- Collection 目的地进入及完整 Portal/Receiver 闭环。
- 右侧装备/沉浸悬浮栏。
- 全局右键/多选/Arc 命令统一。

## 风险与回滚

主要风险是 Core 旧数据中 `context/workflow` ref 指向 scope 或 workspace 的混合形态。投影只有在唯一 Workspace + Surface 条件成立时才启用；歧义继续禁用并保留原因。

回滚只需撤回本批五个文件的可审查 diff；不触碰 Core 顺序数据、Workspace 表、Canvas 内容或已有 child route。
