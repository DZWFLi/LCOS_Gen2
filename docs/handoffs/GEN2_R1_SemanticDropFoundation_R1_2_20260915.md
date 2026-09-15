# GEN2 R1 Semantic Drop Foundation · R1.2 handoff · 2026-09-15

```text
ROUTE: R1
SLICE: R1.2 real source entry + canonical commit bridge
BASE: a6acb1a
BRANCH: codex/r1-semantic-drop-foundation
STATUS: IMPLEMENTED LOCALLY / NOT PUSHED
```

## 本轮新增

- `advanceDropAtScreenPoint()` 作为 pointer-router 与原生 HTML5 `dragover` 的共用驱动；两条输入不会各自再解析一遍目的地。
- `LcosHostOverlay` 监听激活中的 native `dragover`，使用当前 Huabu `screenToFlowPosition`，并阻止浏览器把拖入文件当成页面导航。
- Assembly 瀑布流条目成为真实 drag source：携带 `application/x-lcos-assembly` 数据和 canonical `AssemblySourceRefV1`，不会用 title/id 猜实体。
- pointer-up / drag-end 只在 preview 仍绑定 ready resolution 时创建 transaction；HostOverlay 的 `DropCommitRouter` 调既有 `CoreAssemblyClient.apply()` 或 `useLcosReferenceStore.addEntityToDraft()`。
- Canvas placement 由 Huabu screen→flow 转换后传给既有 Assembly apply 的可选 `placementBySource`；Railway receive 继续走 Assembly apply，绝不调用 Railway order write。
- 新增 `assemblySourceRef.ts` 作为 Assembly button 与 drag source 的共享 identity helper，旧 `AssemblyBody` export 保留兼容调用方。

## 仍未完成的 R1.3

目前没有把“真实拖动经过浏览器页面”的结果写成通过证据。下一片必须在可运行的干净依赖环境做：

```text
Assembly item drag
→ Main canvas target
→ dwell / preview
→ release
→ Core Assembly apply receipt
→ reload / projection readback

Assembly item drag
→ Railway destination target
→ receive preview
→ release
→ membership changes, railway order unchanged

Assembly item drag
→ Composer textarea
→ reference draft exactly once
```

当前隔离 worktree 里的 Huabu React 测试仍受 junction 依赖多 React 副本与 `@agenetes/protocol` 缺件影响，不能把它们冒充浏览器通过。`npm` web-gen2 测试与 R1 pure/host focused tests 通过，具体数字见最终 handoff。
