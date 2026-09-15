# GEN2 P1-C｜T7 Agentlet Host transport 重接施工回执

日期：2026-09-15
范围：LCOS Gen2 `frontend-reconstruction-v2` + Huabu `main`
状态：代码已提交到两仓；未 push

提交：

```text
Huabu main      92844d2 fix(t7): route agentlet continuation through Huabu host gateway
LCOS Gen2       split across the rename commit and the behavior/test commit containing this handoff
```

## 结论

Local Core 已停止把自己伪装成 Agentlet daemon 的 WebSocket peer。T7 现在通过 Huabu Server 的薄 HTTP facade 调用同一个进程内 `AgentletGateway`，由 Huabu 继续持有 `/api/acp/agent` WebSocket、`agentlet/hello`、`server/spawn|stop|list` 的真实 owner。

`sendResource` 没有再被当成 prompt/send。当前 ACP session owner 尚未暴露 prompt 写入方法，所以 continuation `send` 明确返回 `unsupported / prompt_transport_not_wired`，不伪造成功。

## 施工边界

本批只处理四个真实控制动作：

```text
spawn  -> Host facade -> AgentletGateway.spawnOnAgentlet
list   -> Host facade -> AgentletGateway.listOnAgentlet
status -> Host facade -> AgentletGateway.getSession
stop   -> Host facade -> AgentletGateway.stopOnAgentlet
```

不新增第二 Gateway、第二 WebSocket、第二 session registry，也不把 prompt 语义塞进资源投递接口。

## 具体改动

### Huabu Host

- `apps/server/src/modules/agent/acp/continuation-transport.route.ts`
  - `GET /api/acp/continuation/agentlets/:agentletId/sessions`
  - `POST /api/acp/continuation/agentlets/:agentletId/sessions`
  - `GET /api/acp/continuation/agentlets/:agentletId/sessions/:sessionId`
  - `POST /api/acp/continuation/agentlets/:agentletId/sessions/:sessionId/stop`
  - `bridge_not_mounted`、`placement_unavailable`、`session_not_found` 和 Gateway 失败均保留结构化错误。
- `apps/server/src/modules/agent/acp/index.ts`
  - 导出 continuation facade。
- `apps/server/src/app.ts`
  - 在 `/api/acp` 下注册 facade。
- `apps/server/src/modules/agent/acp/continuation-transport.route.test.ts`
  - 验证 list/spawn/status/stop 委托、未挂载 503、非法 spawn 400、未知 session 404。

### LCOS Gen2 / Local Core

- `apps/local-core/src/huabu-agentlet-host-transport.ts`
  - 替换旧 `huabu-agentlet-gateway-transport.ts` 的 WebSocket JSON-RPC 假 peer。
  - 使用普通 HTTP `fetch`、可选 Bearer token、AbortController timeout。
  - 404 session 映射为 lookup miss；HTTP 失败和 timeout 不伪造成功。
- `apps/local-core/src/compose.ts`
  - `HUABU_HOST_URL` 驱动真实 Host transport；`LCOS_RECOVERY_TRANSPORT=fake` 仍只用于 dev/test。
  - `HUABU_AGENTLET_ID`、`HUABU_HOST_TOKEN`（未设时沿用 Huabu 的 `HUABU_CONNECTION_TOKEN`）、`HUABU_AGENTLET_SPAWN_COMMAND`、`HUABU_AGENTLET_SPAWN_CWD` 作为显式配置。
- `apps/local-core/src/huabu-agentlet-continuation-adapter.ts`
  - `send` 返回 `prompt_transport_not_wired`，不再调用 `sendResource`。
- `apps/local-core/tests/huabu-agentlet-host-transport.test.ts`
  - 内容已改为 Host HTTP client 测试；覆盖 spawn/list/status/stop、Bearer、503、timeout、404 和 send unsupported。
- `apps/local-core/tests/continuation-provider-contract.test.ts`
  - 将旧的“sendResource 成功即 sent”断言改成 ACP session owner 未接入前的诚实 unsupported 断言。

## 验证

### 已通过

```text
LCOS local-core typecheck                         PASS
LCOS Host transport + provider contract tests    17/17 PASS
Huabu server typecheck                            PASS
Huabu continuation route tests                    3/3 PASS
```

### 尚未宣称完成的验证

```text
真实运行中的 Huabu daemon hello → Gateway registry → Local Core list/status
```

本批测试的是真实 production route/transport mapping 与 donor 类型，不是把 fake gateway 当成真实 daemon。由于当前会话没有稳定运行的 Huabu server + Agentlet daemon 配置，这一项保留为 `REAL_DAEMON_INTEGRATION=UNVERIFIED`，不能写成完成。

## 明确不变

- 不改 Agentlet daemon 的 `/api/acp/agent` WebSocket 协议。
- 不改 AgentletGateway 的 registry/session truth。
- 不新增通用 Provider 平台。
- 不修改 Canvas、Conversation、Run 或 Continuation journal truth。
- 不触碰工作区内本批之外的 Trae/UX 文档和未提交改动。

## 后续

1. 在可复现的 Huabu server + Agentlet daemon 环境跑一次真实 list/status integration。
2. 等 Huabu ACP session owner 提供 prompt 写入 API 后，再单独补 `send`；届时不得复用 `sendResource`。
3. P1-C 验收后才进入 P2 文档与 ledger 回写。

## 回滚

分别回滚两仓本批 commit 即可。旧 WebSocket transport 不应恢复为生产路径；若临时回退，只允许在隔离实验分支验证，不得重新接入 Local Core production compose。
