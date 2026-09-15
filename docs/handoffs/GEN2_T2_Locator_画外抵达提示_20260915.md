# GEN2 T2 Locator 画外抵达提示施工交付

**日期：** 2026-09-15
**范围：** 生产前端 UX 小切片；未改 Core、Huabu API、Domain、Schema；未提交、未 push。

## 结果

“在哪”对话框发出的 `locateRequest` 现在会在同一 Huabu 画布和唯一 RF camera 上显示画外/近边提示：

- 目标在安全区外：在安全区内缩边上显示“正在定位”方向 cue；
- 目标接近边缘：显示“目标在边缘”方向 cue；
- 目标在舒适区内：不额外遮挡内容；
- 目标标记为 unavailable：显示诚实的“这个对象暂时无法定位”；
- 900ms 后消费 locate 请求，与现有 800ms focus 动画保持同一 settle 窗口。

## 变更前后

```text
F 键 / Navigator「前往」
  → Core binding / 当前 canvas 读取
  → 唯一 RF camera focus
  → （原来只有对话框，画外没有视觉反馈）
```

```text
F 键 / Navigator「前往」
  → Core binding / 当前 canvas 读取
  → LcosCanvasCommands 复用唯一 RF camera
  → locatorGeometry(safeRect, targetRect)
  → 画外 cue / 近边 cue
  → camera settle 后消费 request，目标回到本地内容
```

## 代码落位

- `huabu/apps/web/src/lcos/navigation/LcosCanvasCommands.tsx`
  - 复用 `computeLocatorGeometry`；
  - safeRect 让出 Navigator、Railway、Dock、Composer 的屏幕空间；
  - Professional Window 打开时继续让出窗口左缘，避免 cue 被 Reader/Assembly/Work View 盖住；
  - 目标框来自 React Flow internal node 几何，不读业务实体、不猜坐标；
  - locator cue 使用固定屏幕层，避免进入 React Flow 布局。

## 数据与 owner

- 目标身份：现有 Core binding / `locateRequest`；
- 几何：现有 `apps/web-gen2/src/spatial/locatorGeometry.ts`；
- 相机：现有 Huabu React Flow instance；
- 瞬态显示：canvas-local overlay；
- 没有新增 store、接口、数据库或第二 camera。

## 验证

- `npm run typecheck:web-gen2`：通过；
- `npm run test:web-gen2`：278 tests / 278 passed；
- `npx eslint src/lcos/navigation/LcosCanvasCommands.tsx --max-warnings 0`（工作目录 `huabu/apps/web`）：通过；
- `npm run typecheck --prefix huabu/apps/web`：通过；
- `git diff --check`：通过。

## 尚未宣称完成

- 本轮没有伪造完整 `travelling → arriving → hidden` 状态机；
- 还需要真实浏览器触发画外、近边、抵达、目标失效和 reduced-motion 截图；
- ColorPin producer、Railway Receive/reorder、右侧装备/沉浸栏仍是独立后续切片。

## 回滚

只需回滚 `LcosCanvasCommands.tsx` 本轮差异；不涉及数据迁移和外部系统。
