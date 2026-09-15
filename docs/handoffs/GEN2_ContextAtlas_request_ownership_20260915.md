# Context Atlas 请求归属修复交接

日期：2026-09-15

## 结论

Context Atlas 的 warehouse 请求现在遵循最新请求语义：切换 `projectId` 会取消旧请求、清空旧卡并进入 loading；旧响应或旧错误不能写入当前项目；组件卸载也会取消未完成请求。

## 实际范围

- 保留原 Atlas 卡面和入口行为。
- `getWarehouse(projectId, signal)` 现在接收 `AbortSignal`。
- 用请求序号 + effect 活跃标记做响应归属，兼容底层未及时响应 abort 的情况。
- 新增组件测试覆盖乱序响应、切换时清空旧内容、旧错误隔离和卸载取消。

## 流程变化

```text
变更前：project A 请求 ──晚到响应──> 直接 setItems → 污染当前 Atlas
变更后：project A 请求 ──切换──> abort + 失效
                     └─晚到响应/错误──> 丢弃
       project B 请求 ────────────────> 只有 B 可更新 Atlas
```

## 修改文件

- `huabu/apps/web/src/lcos/surfaces/context/ContextAtlasStage.tsx`
- `huabu/apps/web/src/lcos/surfaces/context/ContextAtlasStage.request.test.tsx`

## 验证

- `npm run test -- --run src/lcos/surfaces/context/ContextAtlasStage.request.test.tsx src/lcos/surfaces/context/ContextAtlasStage.test.ts`：通过，2 个文件 / 5 个测试。
- `npm run typecheck`（`huabu/apps/web`）：通过。
- 新测试文件 Prettier：通过。
- `git diff --check`：通过；仅报告工作树其他文件的既有 CRLF 警告。
- 总装复核发现测试与既有 .test.ts 同名，TypeScript 取舍使 .tsx 未进入项目；已改名为 ContextAtlasStage.request.test.tsx 并修 import/order，重新执行类型与 lint 检查。不是仓库永久阻塞。

## 风险与回滚

风险很小：只改变请求生命周期和过期响应的状态写入。回滚时恢复上述组件文件即可；没有新增 API、schema、数据库或外部写入。

## 未完成

- 未运行浏览器 smoke；本次修复由组件级异步竞态测试覆盖。
