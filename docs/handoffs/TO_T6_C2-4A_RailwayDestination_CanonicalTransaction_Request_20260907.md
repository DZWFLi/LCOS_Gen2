# 给 T6：C2-4A Railway Receive · Canonical Destination/Transaction Request

> 可直接转发  
> 请求方：T2 Navigation / Railway  
> 当前基线：`LCOS_Gen2/main@232b2ca5` + `Huabu@a3c411e1f655191344285141f08c4738fa6015f7`

T2 正在编写 `C2-4A Railway Receive Exact Source Blueprint`，需要你提供 T6 当前最终版的 Railway destination eligibility、canonical ref 与 semantic transaction 契约。Phase B 已关闭语义不要重开，也不要为本请求新增数据库或实现。

请回传以下内容：

1. Railway item/canonical destination 最终 TypeScript 类型全文，以及 exact file/export path。
2. 最终 Railway ontology：
   - Surface Root；
   - explicit long-term Worksite；
   - Receiver/Conversation；
   - legacy compatibility；
   - 明确禁止自动入 Rail 的对象。
3. destination eligibility resolver 的 exact signature：输入、输出、排序、availability/unavailable reason。
4. stable destination identity 如何映射到：
   - projectId；
   - canonical entity/ref；
   - canvasId；
   - home/origin Surface；
   - archived/missing/unavailable 状态。
5. Railway order current migration：旧 `scene|collection|context|workflow + viewId` 如何兼容读取、过滤、迁移和停止新写。
6. Railway receive 的 canonical semantic transaction exact signature，包括：
   - input；
   - ChangeSet/operation id；
   - idempotency；
   - success result；
   - stale/conflict/waiting_input/rejected；
   - undo/revert；
   - ProjectEvents payload/invalidation。
7. 明确裁定哪些 drop 只改变 canonical membership/mapping、source spatial projection 留在原处；哪些 drop 需要请求 Huabu physical cross-Space move。
8. 若 canonical commit 成功但 Huabu move 失败，或 Huabu outcome unknown，T6 期望的 recovery/compensation 状态与责任方。
9. T2 Railway presenter 可以依赖的只读 projection/client contract。
10. 当前真实落地状态：`CURRENT SOURCE / PLAN ONLY / FIXTURE ONLY / NOT LANDED`，以及测试路径。

请用下面格式回传：

```text
BASELINE
EXACT FILES
CANONICAL TYPES
RAIL ONTOLOGY
ELIGIBILITY RESOLVER
SEMANTIC TRANSACTION SIGNATURE
SOURCE-STAY VS PHYSICAL-TRANSFER RULE
MIGRATION
EVENT / RECOVERY MATRIX
T3 HANDOFF
HUABU HANDOFF
TESTS
CURRENT STATUS
OPEN GAPS
```

特别约束：

- 不新建第二个 RailwayStore 或第二套 Worksite system；
- 不把 Huabu node/canvas geometry 写入 Core canonical truth；
- 不把 Collection、Scope、临时 Context block 自动加入 Railway；
- 不用旧 `ProjectViewRailKindV0` 直接冒充最终 ontology；
- 如果 exact contract 尚未落地，请返回最后批准 plan 的文件路径和 planned signature，并明确标 `PLAN ONLY`。

