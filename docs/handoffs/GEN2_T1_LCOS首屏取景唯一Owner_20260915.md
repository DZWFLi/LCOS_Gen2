# GEN2 T1 首屏取景唯一 Owner 纠偏

**日期：** 2026-09-15
**范围：** Huabu Canvas 的 LCOS 模式首屏相机；未改 Canvas 数据、Core、Huabu API 或持久化 schema；未提交、未 push。

## 先说结果

LCOS 模式不再执行 Huabu 旧的 `fitNodesOnCanvas` 首屏取景。首屏由 `LcosCanvasCommands` 的 LCOS 取景逻辑负责，能够让出 Navigator、Railway、Dock、Composer 的屏幕安全区，并遵守可读性 zoom 上限。

## 真实缺陷

Huabu `useInitialCanvasViewport` 在没有保存 viewport 时，会直接对当前节点调用 `fitBounds`。节点少、画布空旷时，结果可能放大到 300% 以上；随后 LCOS 再取景就形成两个相机 owner，截图中出现 348% 的巨型节点。

## 变更前后

```text
Canvas mount
  → Huabu initial fit
  → LCOS projection / HUD mount
  → LCOS fit（可能被前一步抢先放大）
```

```text
Canvas mount (chromeMode=lcos)
  → 跳过 Huabu initial fit
  → LcosCanvasCommands 读取真实 projection completion
  → fitBoundsWithInsets + zoom cap
  → 唯一相机 owner
```

`chromeMode=huabu` 保留原有行为；这次修改只影响 Gen2 LCOS 路由。

## 代码落位

- `huabu/apps/web/src/components/Panels/Canvas/useInitialCanvasViewport.ts`
  - 新增 `deferFit` 选项；延迟模式不执行旧 fit。
- `huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx`
  - `chromeMode === 'lcos'` 时传入 `deferFit: true`。
- `huabu/apps/web/src/lcos/navigation/LcosCanvasCommands.tsx`
  - 继续使用 LCOS safe-inset 取景和唯一 RF camera。

## 验证

- `npm run typecheck --prefix huabu/apps/web`：通过；
- `npx eslint src/components/Panels/Canvas/useInitialCanvasViewport.ts src/components/Panels/Canvas/Canvas.tsx --max-warnings 0`：通过；
- `npm run build --prefix huabu/apps/web`：通过；仅保留既有 CSS `::highlight`、lottie `eval`、大 chunk 警告；
- `npm run test:web-gen2`：278 tests / 278 passed；
- `node scripts/e2e/t2-search-entry-smoke.mjs`：本次被运行环境阻塞，`GET /api/workspace` 返回 500 `Configured workspace has no World canvas`，不是本次 TypeScript 变更错误。

## 尚未宣称完成

- 需要在可用 World canvas 的干净 dev 数据上重新跑浏览器截图，确认 348% 巨型首屏消失；
- 用户已有保存 viewport 时仍尊重保存值，不强行重排用户画布；
- 这次只解决相机 owner 冲突，不改变节点布局、Material、Assembly 或右侧装备栏语义。

## 回滚

回滚 `useInitialCanvasViewport.ts` 与 `Canvas.tsx` 的 `deferFit` 差异即可；不涉及迁移和外部系统。
