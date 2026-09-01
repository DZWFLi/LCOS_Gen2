# Huabu Host Seam Report

> Audit date: 2026-09-01
> Scope: How LCOS Gen2's final GUI reuses Huabu's native pointer/canvas mechanics,
> and the **minimal extension seam** for LCOS custom renderers / overlays /
> connect-intent — WITHOUT building a second canvas.
> Upstream: `microsoft/Huabu @ 58339e269b784728d67730c70bfe7792cae2457d`
> Local study: `E:\OS开发\Huabu`

---

## 0. 结论（裁决）

**Huabu 目前没有面向外部宿主封装的公开插件 seam。** 答案属于审计 §8-A/B 的 **(B)**：

- LCOS 自定义 **节点渲染器**、**画布覆盖层/装饰**、**connect-intent（建边）拦截**，要么写死在 `Canvas.tsx` 单文件里，要么存在“半成品 hook 参数”但**没有打通到运行时注册表**。
- `Canvas` 组件的 props 目前只有 `shortcutsDisabled`（[Canvas.tsx:L398-400](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L398-L400)），**不接受** `nodeTypes` / overlay / recognizer 注入。
- `packages/shared/src/canvas-engine` 是**纯命令/几何/布局引擎**（[index.ts](file:///E:/OS开发/Huabu/packages/shared/src/canvas-engine/index.ts)），对渲染器与指针路由**零感知**。`commands/index.ts` 的 `HANDLERS` 是命令处理器表，不是渲染器/插件机制。

**因此：不需要 fork `packages/shared` canvas-engine，只需要一份最小、集中的薄 fork / vendor 覆盖 —— 把改动收敛到 `apps/web/src` 的 1~3 个文件（核心是 `Canvas.tsx`），并复用几个已存在的“半成品”接口。**

---

## 1. LCOS Gen2 引用的 Huabu 原生能力（复用清单）

这些是 Huabu 已有的、LCOS 应直接复用的机制（**不再重造**）：

| 能力 | Huabu 原生位置 |
| --- | --- |
| 节点几何 / 画布持久化 | `packages/shared/src/canvas-engine`（命令/几何/布局引擎） |
| 节点类型 → 组件映射 | [Canvas.tsx:L159-175](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L159-L175) `const nodeTypes` |
| 缩放选择/框选/拖动/缩放 | `Canvas.tsx` + ReactFlow（`<ReactFlow nodeTypes={nodeTypes}>` [L1511](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L1511)） |
| 指针仲裁 | [pointerRouter.ts:L80-171](file:///E:/OS开发/Huabu/apps/web/src/handler/pointerRouter.ts#L80-L171) `PointerRouterCore` + `PointerRecognizer`（claim/observe/preempt） |
| 节点级覆盖层 slot | [NodeWrapper.tsx:L190-215](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/NodeWrapper.tsx#L190-L215) `overlayContent`/`overlayOffsetY`/`overlayVisible`/`overlayInteractionPriority`；[NodeTakeoverLayer.tsx](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/NodeTakeoverLayer.tsx) `takeover: {renderMark, onActivate}` |
| 建边意图 | [uiIntent.ts:L200-204](file:///E:/OS开发/Huabu/apps/web/src/handler/canvasCommand/uiIntent.ts#L200-L204) `CONNECT_EDGE`；resolve 在 [L532-562](file:///E:/OS开发/Huabu/apps/web/src/handler/canvasCommand/uiIntent.ts#L532-L562) |
| 连接端口手势 | [NodeConnectAffordance.tsx](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/NodeConnectAffordance.tsx) `NodeConnectionHandles`（L583-L988）+ `useCreateConnectedNode` |

---

## 2. LCOS 三类扩展 vs Huabu 现状 + 最小 seam

### 2.1 自定义节点渲染器（Artifact morphology / Glyth / Action Arc 等）

- 现状：`nodeTypes` 是模块级 `const`（[Canvas.tsx:L159](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L159)），无注册表、无合并。
- 最小 seam：把该 `const` 改为合并式，并给 `CanvasProps` 增加可选注入字段：
  ```ts
  const nodeTypes = { ...BUILTIN_NODE_TYPES, ...(extraRenderers ?? {}) };
  ```
  同时在 **previews.ts**（`NodePreviews`，[L14-25](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/previews.ts#L14-L25)）做同样的合并。
- TS 联合：`CanvasNodeData` 已带 `[key: string]: unknown`（[types.ts:L32-92](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/types.ts#L32-L92)），可用 `as`/index-signature 扩展；若需强类型，再同步 `packages/shared/src/types/canvas/node.ts` 的 `CANVAS_NODE_TYPES` / `NodeData` union（[node.ts:L22-39](file:///E:/OS开发/Huabu/packages/shared/src/types/canvas/node.ts#L22-L39)、[L748-763](file:///E:/OS开发/Huabu/packages/shared/src/types/canvas/node.ts#L748-L763)）。`nodeIcons.ts` / `semanticZoom.ts` 的 `NODE_ICON` / `nodeLOD` 需同步增加对应项。

### 2.2 覆盖层 / 装饰（Main/Context/Workflow 语义投影、Work View safe rect、Composer 挂载）

- 节点级：直接复用现成的 `NodeWrapper.overlayContent` / `takeover` props（无需改引擎）。
- 画布级 HUD（选择框、吸附、结构化 drop 提示、语义投影框）：在 [Canvas.tsx:L1617-1645](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L1617-L1645) 的渲染区追加一个 **“external overlays” 占位**；数据可走新建 zustand store（照抄 `gesturePreviewStore` / `nodeCollapseStore` 模式）。

### 2.3 connect-intent 拦截（semantic connect → Core relation → Edge）

- 现状：`useCanvasPointerRouter` 已接收 `extraRecognizers`（[useCanvasPointerRouter.ts:L41-49](file:///E:/OS开发/Huabu/apps/web/src/hooks/useCanvasPointerRouter.ts#L41-L49)），但 `pointerRecognizers` 列表在 `Canvas.tsx` 内部 `useMemo` 生成（[L1076-1157](file:///E:/OS开发/Huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx#L1076-L1157)），外部无法注入。
- 最小 seam：给 `CanvasProps` 增加 `extraRecognizers`（或把内部 list 提升为可合并注册表），即可注入 LCOS 的连接意图识别器（用 `observe`/`preempt` 或 `onDown` 读 `connectPortStore`）。建边类型通过扩展 `ConnectedNodeKind`（[NodeConnectAffordance.tsx:L178](file:///E:/OS开发/Huabu/apps/web/src/components/Nodes/NodeConnectAffordance.tsx#L178)）与 `useCreateConnectedNode` 分支。
- 语义侧仍走 `uiIntent.CONNECT_EDGE` → `resolveConnectEdge`（`CONNECT_NODES` 命令），LCOS 在其上层接 `CoreRelationClient.createRelation`（G0.6）。

---

## 3. 推荐最小覆盖（不 fork 引擎）

| 目标 | 覆盖文件 | 改动 |
| --- | --- | --- |
| 节点渲染器 | `apps/web/src/components/Panels/Canvas/Canvas.tsx` + `components/Nodes/previews.ts` | `nodeTypes`/`NodePreviews` 合并 + `CanvasProps.extraRenderers` |
| 覆盖层/装饰 | `Canvas.tsx`（渲染区）+ 新增 zustand store | 追加 `external overlays` 占位；节点级用 `NodeWrapper.overlayContent/takeover` |
| connect-intent | `Canvas.tsx`（pointerRecognizers 合并）+ `CanvasProps.extraRecognizers` | 注入 `extraRecognizers`；扩展 `ConnectedNodeKind` |
| 类型扩展（可选） | `packages/shared/src/types/canvas/node.ts` | 仅当需要强类型新增节点类型时 |

> 一句话：**只需 fork/vendor 覆盖 `Canvas.tsx` 一个文件**（辅以 `previews.ts` / `nodeIcons.ts` / `semanticZoom.ts` / `node.ts` 少量扩展），并复用 `useCanvasPointerRouter.extraRecognizers`、`NodeWrapper.overlayContent/takeover`、`connectPortStore`、`uiIntent.CONNECT_EDGE` 这几个现有接口，即可在不 fork `packages/shared` canvas-engine 的前提下实现三类扩展。

---

## 4. 禁第二套 canvas 的边界

- **RFS 保留为控制端口**：`/api/rfs/*` 用于 Core→Spatial 投影、agent/后端空间控制、集成测试端口。用户直接 pointer gesture 走 **Huabu 原生 UI event seam**。
- **绝不**在 `web-gen2` 里再实现一套 canvas runtime、renderer、camera、pointer-router 去“遥控” Huabu —— 那会重新产生第二套前端 spatial runtime（审计 §8 明令禁止）。
- Geometry 的唯一权威在 Huabu；LCOS Core 只存 identity binding，不存 geometry（G0 裁决）。

---

## 5. 结论

LCOS Gen2 GUI 应运行在 **Huabu interaction substrate** 之上，通过上面 **§3 的最小 seam** 注入自定义 renderer / overlay / connect-intent，而不是另起一套 canvas。这一 seam 属于**薄 vendor 覆盖**（集中在一个文件），不 fork canvas-engine，符合审计 §8-B 的推荐方向与 §8 末尾“禁止另做第二套 canvas”的约束。
