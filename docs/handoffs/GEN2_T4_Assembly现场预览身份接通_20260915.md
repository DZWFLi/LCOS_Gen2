# T4 Assembly 现场预览身份接通

日期：2026-09-15。未提交、未 push。范围为 Assembly 的真实现场预览入口及读取归属，不代表子现场进入/返回已经完成。

## 修复与原因

旧路径把 scene 的 entityRef.id（实际是 workspaceId）直接传入 Portal，且没有 targetKind。Portal 无法将其当成 canvas 地址。

现在：Assembly scene → CoreProjectClient.getWorkspaces → exact workspace.id → workspace.canvasId → openWindow(portal-preview, target, canvas) → 既有 PortalPreviewBody/SpacePreviewViewport。

没有新增 API、数据库、画布或业务对象。无映射明确显示“现场画布尚未就绪”；上下文/工作流 scope 不再直接把 scopeId 当 canvasId。

仓库与现场映射读取使用独立结果：现场信息失败不阻塞材料显示，并提供真实重试按钮。项目切换、卸载或新一轮读取后，旧响应不会覆盖当前仓库。

## 验证

- Assembly mapping、生命周期、Portal body 共 3 文件 12 测试通过。
- 定向 ESLint、包含 TypeScript 检查的 build 通过；构建仍有既有 highlight CSS、lottie eval 与包体积警告。
- 生命周期覆盖 A 慢响应不覆盖 B、scene 点击传真实 canvas target、workspace 失败时材料仍可用。
- `node scripts/e2e/assembly-scene-portal-smoke.mjs` 通过：真实仓库 scene → 真实 Portal 预览；前后 URL 与宿主 camera style 相同；无 console/page/HTTP error。
- 已目视截图 `.e2e-data/shots/assembly-scene-portal.png`，能看到实际目标内容，复用既有窗口 tab。

## 下一段的准确事实

原审计“完全无 Context→child 映射”的说法过宽：warehouse 的 context/workflow/collection 来自 Scope；Workspace 已有正式 scopeId 与 canvasId。可沿 scopeId 找到相关现场，但一 Scope 可以对应多 Workspace，不能选第一个冒充唯一 child。真实 dev 三个根现场均关联 scope-real-root，足以证明这一点。

Figma `5350:21134` 原文：“Context子画布是工作现场。进入经同一Portal/T2机制，成功后Back返回Main来源位置；缺映射是实现缺口，不是可选产品身份。”

因此接下来应复用 scope→workspace 候选关系，提供明确目标选择，再做同一 Huabu canvas 的进入/settle/来源 camera 与 selection 返回。不能新建第二套图运行时，也不能把关闭预览等同返回。此段仍未施工完成。

## 文件与回滚

- `huabu/apps/web/src/lcos/professional/AssemblyBody.tsx`
- `AssemblyBody.test.ts` / `AssemblyBody.lifecycle.test.tsx`
- `scripts/e2e/assembly-scene-portal-smoke.mjs`

回滚仅撤本轮相关差异，保留其他未提交工作和原始数据；不修改用户画布坐标。

## 后续增量：集合的多个现场明确选择

已实现：context / workflow / collection 按真实 scopeId 匹配 Workspace，复用 Huabu DropdownMenu 展示所有候选。用户明确选择后才按该 Workspace.canvasId 打开原 Portal 预览。无 canvasId 的候选禁用并说明原因；不根据名称或 preferredSurface 猜目标，不默认取第一个。现场读取失败与确实没有关联分别提示。

操作：Assembly 集合 → 选择现场预览 → 选择具体现场 → 同一 Portal 预览。Esc 先收起候选菜单，保留 Assembly。此动作仍是预览，不是进入可编辑子现场。

验证：
- Assembly mapping / 生命周期 / workspaceTargets / Portal 共 4 文件 17 项测试通过；定向 ESLint 通过。
- TypeScript + Vite build 通过；保留上文既有构建警告。
- assembly-scope-menu-fixture.mjs 浏览器通过，截图 .e2e-data/shots/assembly-scope-menu-fixture.png 已目视。
- 浏览器测试仅替换仓库响应中的一个测试集合，现场候选及预览使用真实服务；没有写数据库。它验证多候选选择、Esc、第二候选真实预览请求，不代表真实 Context 创建生产链已经验收。

新增文件：workspaceTargets.ts / workspaceTargets.test.ts、scripts/e2e/assembly-scope-menu-fixture.mjs；其余延用上文 Assembly 文件。

下一步的具体阻碍：getCanvas 当前把非 404 的失败也返回 null；loadCanvas 又吞掉异常，switchCanvas 完成不能证明目标加载成功。必须先区分加载失败与目标不存在，避免断网时误导重建。完整进入 / 返回及来源选择恢复仍未完成。
