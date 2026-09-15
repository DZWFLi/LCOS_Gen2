# GEN2 Context / Workflow 子现场进入返回与保存队列收口

日期：2026-09-15
范围：前端 UX 接缝与 Huabu 现场切换稳定性
状态：代码已改、未提交、未 push

## 这轮解决的问题

Figma Portal P06 的硬要求是：Context 子画布也是工作现场，进入必须使用明确的 workspace 身份，完成后能回到 Main 来源位置。原实现只有预览或“当前现场定位”，没有真实的子现场路由；多个 Workspace 共享一个 scope 时也存在选首条的风险。

本轮把这条路径接上：

```text
Assembly / Context Atlas
  → 选择明确 Workspace
  → /projects/:projectId/:surface?workspaceId=:workspaceId
  → 复用 Huabu 唯一 Canvas kernel 加载该 Workspace.canvasId
  → 返回来源现场并恢复来源选中节点
```

预览仍是 Portal 的只读窗口；进入现场是路由切换，两者不再混为一个动作。

## 实际修改

- `huabu/apps/web/src/lcos/app/LcosProjectRoute.tsx`
  - 读取 `workspaceId` 查询参数并原样传入 Shell；非法 Surface 重定向时保留查询参数。
- `huabu/apps/web/src/lcos/shell/LcosProjectShell.tsx`
  - 按 `workspaceId` 精确解析子 Workspace 与 canvasId。
  - 子现场缺失或无画布时显示可理解的不可用态，不调用根现场的创建逻辑。
  - 增加“返回来源现场”；同一标签页有来源快照时切回来源 canvas 并恢复选中节点，直链进入时安全回退 Main。
- `huabu/apps/web/src/lcos/shell/lcosShellStore.ts`
  - 新增短生命周期 `LcosChildReturn`，只存 UI 返回上下文，不存 Project/Run truth。
- `huabu/apps/web/src/lcos/app/useLcosWorksite.ts`
  - 同一 preferredSurface 出现多个 Workspace 时不再静默选第一条；根 Dock 只接受唯一候选，子现场仍可用明确 id 进入。
  - 新增按 `workspaceId` 的画布建立/回写方法；子现场 404 恢复不会误写根 Context/Workflow 画布。
- `huabu/apps/web/src/lcos/navigation/workspaceTargets.ts`
  - 新增按实体语义解析子现场目标：Context/Collection→Context，Workflow→Workflow，Scene 只接受 Workspace 自带的合法 `preferredSurface`。
- `huabu/apps/web/src/lcos/professional/AssemblyBody.tsx`
  - Workspace 候选菜单拆为“预览现场 / 进入现场”；多候选使用子菜单逐个选择，缺画布禁用。
- `huabu/apps/web/src/lcos/surfaces/context/ContextAtlasStage.tsx`、`ContextWorksite.tsx`
  - Atlas 同样支持精确 Workspace 进入；多候选不猜默认值。
- 保存队列相关变更保持：结构保存和节点内容保存失败会保留 dirty/pending，切现场前会等待或阻止离开。

没有新增 Core API、数据库迁移、第二画布 runtime，也没有改变 Huabu Canvas 数据模型。

## 验证

- Huabu web TypeScript：通过。
- Huabu web production build：通过（仅已有 CSS pseudo-element、chunk size 等构建提示）。
- 定向 Vitest：5 files / 23 tests passed；加入子现场进入测试后 Assembly 仍全绿。
- `scripts/e2e/assembly-scope-menu-fixture.mjs`：通过。覆盖多 Workspace 选择、只读 Portal 预览、进入子现场、精确 canvas、返回 Main。
- `scripts/e2e/child-workspace-return.mjs`：通过。覆盖显式 `workspaceId` 直链、精确 canvas、无来源快照时回退 Main。
- `scripts/e2e/t2-search-entry-smoke.mjs`：通过，原有搜索/定位入口未回归。
- 全仓 Huabu 测试仍有开工前既有失败：Milkdown `blockFingerprintParity` 一例，以及依赖本机 `localhost:3000` 的连接拒绝；本轮未触碰相关文件。

## 尚未宣称完成

- 真正由 Core 产生 Context/Workflow 子 Workspace 的业务入口仍由后端/产品数据决定；本轮只把已有 Workspace 的进入与返回语义接通。
- 直链刷新后没有来源快照，只能回退 Main；这是无来源信息时的安全行为。
- Portal 的 approach / restore 动效、Context 事情/时间组织字段仍按现有规划保留为后续视觉深化。

## 回滚

按文件逐项 revert 本轮变更即可；未创建迁移、未重写历史、未改动用户未提交的其它工作区内容。
