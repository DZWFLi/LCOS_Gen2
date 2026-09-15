# GEN2 P0 Completion — Current HEAD Integrity

日期：2026-09-15

## 基线与范围

```text
parent: frontend-reconstruction-v2@b5784bb894bf1e328a06385ceebf6e568e665c44
scope: P0 completion only
```

本回执只收口当前远端已经暴露的直接依赖断口，不回滚 `b5784bb`，也不带入 Agentlet transport、Projection partial-retry、Continuation concurrency 或 `pnpm-workspace.yaml`。

## 本次补齐

1. 补齐 `apps/web-gen2/src/presentation/glythPresentation.ts`，并由 `apps/web-gen2/src/index.ts` 导出；新增 deterministic presentation test。
2. 补齐 `apps/web-gen2/src/presentation/nodeHostPresentation.ts` 及其导出。Huabu 当前已由 `createLcosNodePresentationSeam.ts` 真实 import，这个 companion 不能继续留在未跟踪状态。
3. `LcosNodeCommandId`、`buildLcosNodeCommands()`、近场 primary 选择和测试补齐 `compose`；Assembly 仍保持独立入口。
4. 用户可见的“工作台”文案统一为“会话窗口”；代码注释中使用 `Conversation Work View`。

## 真实性边界

- `resolveGlythPresentation` 是 presentation helper，不拥有 Conversation、Run 或 Canvas truth。
- `resolveLcosNodeHostPresentation` 只提供 Huabu NodeWrapper 的呈现宿主参数；几何和持久化仍由现有 Huabu/Projection owner 管理。
- `compose` 只建立 Action Arc → Composer 的意图入口，不伪造 Run 成功。

## 验证记录

以下结果以当前 P0 completion commit 的实际命令输出为准，未通过项必须保留原始原因：

```text
web-gen2 typecheck: PASS
web-gen2 tests: PASS (273/273; P0 commit scope, excluding the unrelated untracked projection-geometry test)
Huabu typecheck: PASS
Huabu lcos 定向测试: PASS (43 files / 188 tests)
Huabu production build: PASS
gen2-ux-runtime-contract.mjs: PASS（isolated R0 env :5273；console/pageerror/http 均为 0）
真实浏览器 Action Arc → Composer: PASS（同一 isolated env；节点选择 → Arc compose → 单 Composer 几何与入口断言）
```

说明：第一次在普通开发端口运行时命中了 Huabu 首次启动 `/setup`，不是应用运行时通过；随后改用仓库已有的隔离 R0 环境（43131/3011/5273），完成可复现的真实浏览器验收。E2E 还修正了一处测试断言：Professional Window 关闭后宿主按设计保留为 `hidden` 的空 stage，验收改为检查 `attached + data-empty=true`，不再错误等待可见状态。

## 未纳入

- `apps/local-core/src/huabu-agentlet-gateway-transport.ts` 及其 mock：真实 Host/Server 协议尚未接入验证。
- `apps/local-core` continuation 的跨记录 `core_bind` 原子性。
- `apps/web-gen2` projection runner 的 partial-failure retry 完成语义。
- `pnpm-workspace.yaml`：误生成占位文件，不提交。
