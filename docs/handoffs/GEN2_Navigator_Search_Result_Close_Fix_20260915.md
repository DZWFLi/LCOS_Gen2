# GEN2 Navigator 搜索结果收口修复

日期：2026-09-15
范围：`huabu/apps/web/src/lcos/navigation/LcosNavigatorIsland.tsx` 与对应测试；未提交、未 push。

## 结论

已修复两个可复现的搜索结果行为缺口：点击当前现场已投影对象后，原实现虽然发出 `requestLocate`，但仍保留搜索输入和结果列表，导致抵达目标后临时搜索层继续遮挡画布；同时，`nodeEntityRefs` 是投影绑定缓存，可能短暂保留已从当前 Huabu canvas 移除的 nodeId。现在只有绑定命中且 nodeId 仍存在于当前 `useCanvasStore` 节点列表时才发出 locate 并关闭搜索；stale binding 保留搜索层并显示诚实的不可定位提示。

## 原案依据与流程

Figma Navigator 结构 `5384:367` / `structures/navigator/nodes-000.json` 明确：搜索展开“暂替换静息空间；Esc 恢复”；HUD 规格 `specs/hud.json` 的 Navigator 状态要求 focus 对应对象 Where/arrival。当前实现已有唯一 `requestLocate` caller，因此采用最小收口：

```text
搜索结果
  → 当前现场已有投影且 nodeId 仍在当前 Huabu canvas
  → requestLocate(projected)
  → 关闭临时搜索层
  → Huabu camera consumer 继续处理目标聚焦
```

用户操作变化：点击可定位搜索结果后，搜索岛立即回到静息态，Esc 仍可关闭普通搜索；跨现场/无位置结果仍显示位置语义并保留搜索上下文。

## 修改与验证

- 生产：`LcosNavigatorIsland.tsx` 复用当前 `useCanvasStore.getState().nodes` 做存在性校验；只有 projected locate 后才调用既有 `closeSearch`。
- 测试：`LcosNavigatorIsland.test.tsx` 覆盖正常结果收口与 stale binding 保留搜索上下文；原 loading/error/Escape 测试继续通过。
- 命令：`npm run test -- src/lcos/navigation/LcosNavigatorIsland.test.tsx`（3/3 PASS）。
- 命令：`npx eslint src/lcos/navigation/LcosNavigatorIsland.tsx src/lcos/navigation/LcosNavigatorIsland.test.tsx --report-unused-disable-directives --max-warnings 0`（PASS）。
- 命令：`npm run typecheck -- --pretty false`（PASS）。

## 未验证与风险

已验证 React 容器行为和请求发出；未做浏览器整页 smoke、真实 Core 返回、Huabu camera settled/arrival overlay 验收。跨现场 arrival、Locator overlay、ColorPin producer 仍是原审计中明确的未实现/未验证范围，本修复没有扩展这些语义。

## 回滚

回滚本次新增的 `closeSearch()` 调用及对应测试即可；保留工作区其他已授权脏改动，不使用 reset 或覆盖。
