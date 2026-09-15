# GEN2 Portal root 映射只读设计记录（2026-09-15）

## 结论

Portal 进入/返回的最小稳定键是 `projectId + workspaceId`；`preferredSurface` 只能作为一级表面提示，不能作为 workspace 身份或 root 选择器。现有 `surfaceCanvasId` map 遇到同 surface 会覆盖，不能用首条/末条记录冒充确定 root。

## 现有事实与精确来源

- `CoreProjectClient.getProjectGraph(projectId)`：`apps/web-gen2/src/backend/projects.ts:62-68`，返回 `ProjectGraphSnapshot`，其中含 `scopes`、`workspaces`。
- `CoreProjectClient.getWorkspaces(projectId)`：`apps/web-gen2/src/backend/projects.ts:70-78`，返回带 stable `canvasId` 的 workspace 列表。
- `CoreProjectClient.updateWorkspaceCanvasId(projectId, workspaceId, canvasId)`：同文件 `:80-93`，按明确 workspace ID 回写 Canvas。
- `LcosProjectShell` 的当前 workspace 解析：`huabu/apps/web/src/lcos/shell/LcosProjectShell.tsx:67-72`，按 `surfaceByWorkspace` 找第一条匹配 surface；同 surface 时身份不确定。
- `useLcosWorksite` 的 surface map：`huabu/apps/web/src/lcos/app/useLcosWorksite.ts:69-79`，`map[pref] = workspace.canvasId`；重复 `preferredSurface` 时后写覆盖前写。
- Domain `Scope`：`packages/domain/src/index.ts:57-68`，正式 root 语义是 `Scope.kind === 'root'`，并由 `parentScopeId === null` 表示顶层。
- Domain `Workspace`：`packages/domain/src/index.ts:171-186`，有 `id/projectId/scopeId/preferredSurface?/canvasId?`，没有 root 标记。
- Local Core `workspaces` 表：`apps/local-core/src/metadata-repository.ts:1002-1011`，`preferred_surface` 无 UNIQUE；workspace 主键只有 `id`。
- `getWorkspaces` 返回顺序：`apps/local-core/src/metadata-repository.ts:2371-2373`，按 `sort_index, rowid`；因此首/末条都不是契约身份。
- Workflow 导入/导出已支持显式 `scopeId`：`apps/local-core/src/routes/workflow.ts:25-32`、`:41-55`；缺省才回退 root scope。

## Root / child 处理规则

1. **Root scope**：从 graph 的 `scopes` 中筛 `kind === 'root'` 且 `parentScopeId === null`。若得到多个，不选首/末；记录为数据歧义并保持不可判定。
2. **Root worksite**：使用与目标 surface 明确绑定的 workspace `id`，再读取它的 `scopeId/canvasId`。不能仅凭 root scope 反推出 Main，因为多个 workspace 可以共享同一 root scope。
3. **Child worksite**：Portal payload 携带真实 `workspaceId`；返回时按 `workspace.id` 精确恢复。child 的 `scopeId` 只描述语义范围，不替代 workspace 身份。
4. **同 root + 同 preferredSurface**：现有模型无唯一约束，也无正式 root workspace 标志；视为歧义数据。UI 不得以 map 的覆盖结果、首条或末条作为选择结果。若无精确 workspace ID，保持不可用/要求重新选择。
5. **缺 Canvas**：调用 `updateWorkspaceCanvasId(projectId, workspaceId, canvasId)` 对指定 workspace 回写；不要调用按 surface 反查的 ensure 路径。

## Portal 最小复用路径

```text
Portal source
  -> 保存 source surface + source window/camera/focus 状态
  -> 携带 target workspaceId（必要时附 scopeId）进入 child
  -> graph/workspaces 按 workspace.id 精确取 target canvasId
  -> child 操作
  -> 返回 source
  -> 按保存的 source surface/workspace 恢复 camera/focus
```

这符合原施工卡：Portal 是同项目空间入口/投影锚点，退出恢复相机与焦点，且不创建第二套 graph/selection/geometry truth（`deliverables/GEN2_新前端重新总装正本_20260913/01_真实产品概念与不可误解项.md:110-116`）。Wave 6 验收要求同一 collection 进入 Context child 后返回 Main，entity、位置和状态保持正确（同目录 `04_逐Wave施工卡与验收.md:267-273`）。

## 建议 caller 落点

- `LcosProjectShell.tsx`：保留一级 surface 切换；active workspace 应来自明确 workspace ID，不能由 `surfaceByWorkspace.entries().find()` 推导 child。
- `useLcosWorksite.ts`：surface map 仅服务一级 surface；Portal child 不复用该 map。
- `LcosRailway.tsx`：已有 graph workspace/scope 投影（`:61-89`）；目的地应继续携带 workspace ID，避免仅传 surface。
- `apps/web-gen2/src/backend/projects.ts`：复用现有 `getProjectGraph/getWorkspaces/updateWorkspaceCanvasId`，无需新增 API。
- Canvas/active context callers：现有 `workspaceId` query 语义可复用；缺省值才表示 project/root overview。

## 范围与验证

本记录仅为只读源码与既有 T1/T2/Figma UX 约定核定；未修改生产代码、domain、Core schema 或 API，未新增模型。工作区原有 dirty 状态保持不变。
