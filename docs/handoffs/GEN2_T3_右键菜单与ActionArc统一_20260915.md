# GEN2 T3 右键菜单与 Action Arc 统一施工交付

日期：2026-09-15
范围：T3 操作语言与共用输入、T1 Huabu Canvas 入口
状态：本地已修改，未提交，未 push

## 结论

LCOS 模式下，已经由 Action Arc 接管的节点类型现在可以通过右键呼出临时节点命令菜单。菜单直接复用 `buildLcosNodeCommands` 和 Arc 的同一 `dispatch`，不会再生成第二套命令语义。

这只收口了“Arc 已覆盖类型”的右键入口。PDF、Office、Web、Sketch、Question、Frame 以及未绑定普通 Text 仍按 Huabu 原生入口处理；旧命令尚未完全接管的类型没有被强行隐藏。

## 流程

```text
右键 Canvas 节点
  → 识别 React Flow node[data-id]
  → 仅对 Arc 已覆盖类型打开 LCOS 临时菜单
  → buildLcosNodeCommands
  → 与 Action Arc 共用 dispatch
  → canvas store / shell store / preview workspace 真实副作用
```

## 用户操作变化

- 对 Note/Image/Video/Audio/CanvasRef/NodeRef，以及 Core-bound Text，可右键打开节点命令菜单。
- 菜单中的打开、围绕对象工作、引用、删除、移动现场、适合画面等动作与 Action Arc 使用同一命令 id。
- 尺寸和强调色会关闭右键菜单并回到同一节点的 Arc“更多”面板，不复制一套输入控件。
- Esc 或点击菜单外关闭临时菜单。
- Composer、Reader、Assembly、Portal 等专业窗口在前台时，右键菜单不会抢焦点。

## 实现落点

- `huabu/apps/web/src/lcos/navigation/LcosActionArc.tsx`
  - 增加 Canvas 节点右键监听与临时菜单状态；
  - 右键前选中确切节点；
  - 复用现有命令分组、禁用原因和 dispatch；
  - 不新增 store、runtime 或业务命令表。

## 验证

- Huabu web TypeScript：通过。
- Action Arc 修改文件 ESLint：通过。
- `node scripts/e2e/lcos-context-menu.mjs`：通过；无 console/page/http 错误。
- 生产构建：通过；保留既有 CSS `::highlight`、lottie `eval` 和大 chunk 警告。

## 尚未完成

- Huabu 全部原生命令（复制/粘贴、撤销/重做、连线、框/组、多选）尚未逐项迁入 LCOS 统一菜单。
- 未接管类型仍需逐类核对旧入口与未来 Action Arc 的替代关系。
- 全局 Esc/焦点组合仍需搜索、Atlas、手牌、Reader、窗口同时打开时的浏览器验收。

## 风险与回滚

右键菜单只在 Arc 已覆盖类型出现，避免与尚未接管的旧工具条重复。若后续发现某个类型的旧命令未被完整覆盖，可撤回本文件对应的 Action Arc 增量，不会影响 Huabu 原生命令、Canvas 数据或 Core truth。
