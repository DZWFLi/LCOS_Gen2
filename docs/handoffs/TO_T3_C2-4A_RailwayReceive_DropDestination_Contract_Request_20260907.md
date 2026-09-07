# 给 T3：C2-4A Railway Receive · DropDestination Contract Request

> 可直接转发  
> 请求方：T2 Navigation / Railway  
> 当前基线：`LCOS_Gen2/main@232b2ca5` + `Huabu@a3c411e1f655191344285141f08c4738fa6015f7`

T2 正在编写 `C2-4A Railway Receive Exact Source Blueprint`，需要你提供 T3 当前最终版的 typed DropDestination 与 commit seam。已关闭的产品语义不要重开，也不要为本请求新增实现。

请回传以下内容：

1. `DropDestination` 最终 TypeScript 类型全文，以及它所在的 exact file/export path。
2. Railway destination 对应的 discriminant/kind、必填字段、可选字段和稳定 identity 字段。
3. Drop intent 从 pointer/drag payload 到 destination resolution 的 exact function/type 路径。
4. commit 入口的 exact function signature，包括：
   - 输入；
   - 成功结果；
   - rejected/waiting/conflict/unknown outcome；
   - cancel/stale 语义；
   - 是否支持 `AbortSignal` 或等价取消。
5. T3 如何区分：
   - source-stay semantic drop；
   - visible-host spatial relocation；
   - remote-target/portal drop；
   - physical cross-Space transfer。
6. T3 当前是否已经定义 transaction/operation id、idempotency key、optimistic presentation 与 rollback/compensation contract。
7. Railway hover/armed/commit/result 所需的 presenter-facing state/type；若没有正式类型，请明确写 `NOT DEFINED`，不要临时起名。
8. 当前真实落地状态：`CURRENT SOURCE / PLAN ONLY / FIXTURE ONLY / NOT LANDED`。
9. 对应测试文件与已覆盖 case。
10. 与 T6 canonical transaction、Huabu `POST /canvas/:canvasId/move-selection` 的责任边界。

请用下面格式回传：

```text
BASELINE
EXACT FILES
EXPORTED TYPES
COMMIT SIGNATURE
STATE / ERROR MATRIX
SOURCE-STAY VS PHYSICAL-TRANSFER RULE
T6 HANDOFF
HUABU HANDOFF
TESTS
CURRENT STATUS
OPEN GAPS
```

特别约束：

- 不把 Huabu `MoveSelectionModal` 当 Railway 主 UX；
- 不让 T3 保存 canonical Railway/Worksite truth；
- 不用前端坐标或 node id 冒充 canonical destination；
- 如果最终契约尚未落地，请给最后批准的 plan 原文路径和 planned exact signature，不要凭记忆复述。

