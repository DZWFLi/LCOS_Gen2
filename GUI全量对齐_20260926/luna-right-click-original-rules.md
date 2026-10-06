# T3 右键入口：原规则与当前落点

结论：节点右键打开管理菜单；对象附近的 Action Arc 负责高频动作，More 展开完整命令。右键拖动是 Carry，过程中不弹菜单且源对象保持原位。空白画布右键仅由 Huabu 接管并抑制浏览器菜单，原卡未定义空白右键创建。

## 用户操作预期

- **节点右键**：在支持 LCOS 的节点上，以指针位置打开节点管理菜单。Action Arc 小而贴近对象，只放高频直接动作；管理/组织/复制/删除等完整操作在 Right-click/More。Arc 与管理菜单不能混成一层浮层。
- **物种适配**：原卡要求 Content-like 对象 double-click 按物种打开/编辑/工作，Glyth 有自己的点击与双击语义，且标为 card/node 特例。原件没有列出 convert-text、auto-height、accent、open-large、move-space 的具体物种适用矩阵；不能把现有通用菜单动作反推成原卡要求的通用能力。应按对象能力显隐适用动作，尤其不能把文本编辑动作默认送给 Glyth/collection。
- **右键拖动**：源固定并显示 proxy；目标 valid/invalid，commit 后给 receipt，拒绝后 settle。该手势全程不弹 context menu，也不能造成原对象被搬走的错觉。
- **空白处右键**：阻止浏览器原生菜单；原卡没有“空白右键创建”契约，不能据此新增创建菜单。原卡未明确空白区域的创建入口，不能补写为右键创建。
- 输入、textarea、select、contenteditable 和链接保留浏览器默认行为。

## 当前代码对照

- `huabu/apps/web/src/components/Panels/Canvas/Canvas.tsx:1425`：画布根拦截非编辑区域的 contextmenu。
- `huabu/apps/web/src/lcos/navigation/LcosActionArc.tsx:203`：window 监听只在节点上、身份就绪且符合 LCOS 接管条件时阻止默认菜单、选中节点并按指针坐标打开菜单；空白区因找不到节点而返回。
- 同文件 `:373` 起由 `primaryNodeCommands` 和 `ARC_GROUPS` 分组 More。菜单使用 `buildLcosNodeCommands`；需逐项检查其动作是否按节点物种过滤。当前接管条件基于 `shouldStandDownLegacyNodeToolbar`，不能等同于具体命令对物种的有效性证明。

## 原件依据

原件根目录：`E:\TRAE项目\LCOS0.1收口\_cabin\01_正本\GEN2_新前端重新总装正本_20260913\references\original_route_cards`。

- `T3/LCOS_Gen2_T3_C1-S0_PhaseB_Interaction_Contract_Lock_20260906.md` §15（约 668–685 行）：Right Carry = source fixed / proxy / accept / reject / settle；§8 及 RETIRE-06（约 329–350、567–574 行）定义 Glyth 点击层级与 card/node special case。
- `T3/LCOS_Gen2_T3_C1-S1_Current_Source_Exact_Map_20260906.md` §6（534–570 行）：Canvas root 接管/抑制非编辑区浏览器 context interaction；记录当时 LCOS 管理菜单 seam 尚未落地。
- `T3/LCOS_Gen2_T3_C1-S3D_ExactFileCards_LocalOverlay_WorkView_T5Consumption_20260906.md` §6.5（1557–1565 行）规定 Carry 状态及源对象视觉不搬动；约 2320 行明确 `right drag → Carry → no context menu`。
- `V6/03_T3_LocalInteraction_ActionArc_Composer_30KB_Planning_Guide.md` Thread 3（约 1510–1542 行）：drag 必须保留；double-click 与 Glyth 行为按物种；Action Arc 不是管理菜单全集，Right-click/More 放完整管理动作。该卡不含五个 command id 的物种矩阵。

