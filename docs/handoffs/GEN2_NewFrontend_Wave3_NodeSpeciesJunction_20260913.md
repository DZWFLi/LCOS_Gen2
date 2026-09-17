# Wave 3 施工交付 — 全节点 Presentation Junction / 物种 / LOD

日期：2026-09-13　分支：frontend-reconstruction-v2
对应卡：`04_逐Wave施工卡与验收.md` Wave 3

## 用户现在真实能做什么

已绑定 Core entity 的节点不再千篇一律是 Huabu note——会话类节点现在是 LCOS Glyth 物种体（暗底首字符身份圈 + 会话角标 + 密度分层文案），并且是**原地换 body**（同一节点 geometry/selection 不变）。未绑定的 27 个原生节点仍诚实显示 native；随 zoom 变化密度 mark→summary→working→reading 文案自动切换（远看角标、近看 meta）。

## Before → After

- Before：只有 conversation-bound note 的狭窄 body resolver（archive 后期）；Wave 3 前 `resolveNodeBody` 未接线，全部 native。
- After：通用 binding-aware `CanvasNodePresentationSeam{resolve,subscribe}` 生效（Wave 0 恢复的机制 + 新 resolver）；`nodeSpecies` 纯逻辑（entityType 优先、绝不用 title/id 猜）；12 物种 body 注册表；seam 接入 runtime composition（hostExtension.resolveNodeBody）。
- 浏览器实测：5 个 conversation 绑定节点渲染为 glyph species body；27 个未绑定节点 native fallback（诚实）。

## Production caller

```text
useLcosCanvasProps → createLcosNodePresentationSeam() → HostSeam.resolveNodeBody
→ hostExtensionFromSeam → CanvasHostExtension.resolveNodeBody
→ Canvas NodeBodyResolverContext.Provider → NoteNode useResolvedNodeBody（useSyncExternalStore）
→ NODE_SPECIES_BODY[species] → LcosSpeciesBody（zoom → density）
```

## 修改文件

- `apps/web-gen2/src/presentation/nodeSpecies.ts`（新增，React-free）+ `test/nodeSpecies.test.ts`；`index.ts` 导出。
- `huabu/apps/web/src/lcos/nodes/LcosSpeciesBodies.tsx`（12 物种 body + species accent/角标）+ `createLcosNodePresentationSeam.ts` + test。
- `huabu/apps/web/src/lcos/useLcosCanvasProps.tsx`（seam 接线 + 注释更新）。
- `scripts/e2e/wave3-species.mjs`。

## Donor/Figma 采用

- GEN1 donor：`CanvasNodeVisual.tsx` 内容分流语义（A/B 换壳）；`nodeCardRegistry` 思路（B，禁 silent fallback）。
- Figma：NodeSpecies 主稿语义（物种 = 形态/图标/比例/状态位语言，不只颜色）；token（surface/inverse/危险色/圆角）。
- `nodeSpecies` 映射对照 01 文档物种表（source/working/draft/context-reference/run/decision/glyth/collection/workflow-collection/portal/prompt-frame/unknown）。

## 真实数据路径

main 画布 32 节点：`reconcile('project-open')` 投影 conversation → ProjectionBinding → reference store（nodeEntityRefs）→ seam.resolve(nodeId) → entityType=conversation → glyth → body。

## 浏览器操作与截图（scripts/e2e/wave3-species.mjs + run8/9）

| 断言 | 结果 |
|---|---|
| node 总数 32、LCOS body 5 | ✓ 5×glyph |
| 未绑定节点 native（不误伤） | ✓ 27 native |
| zoom 0.28→0.65 时画外节点被 RF 视口裁剪（非 bug，zoom out 恢复） | ✓ 0.094 时 glyph 5 恢复 |
| density 阶梯（mark→reading meta 文案） | ✓ 逻辑单测 + 视觉走查 |
| Console | 无本批错误 |

## 测试命令与结果

| 验证 | 结果 |
|---|---|
| web-gen2 typecheck + test | PASS（230/230，含 nodeSpecies 8 组用例） |
| huabu typecheck | PASS |
| huabu vitest（nodes/host 目录新测试） | 2 passed |
| huabu vitest 全量 | 172/173（唯一失败 = Milkdown blockFingerprintParity 环境项，非本波） |
| eslint lcos/nodes | PASS |

## 未完成 / FALLBACK / FIXTURE / UNAVAILABLE

- artifact 的 draft/collection/decision/portal 等 kind 级物种：投影节点 data 仅含 label，需 Wave 5/6 接入 Core read model 后按 metadata 精确化（现在是 entityType 级物种，诚实）。
- Run/Decision/PromptFrame body 深化（真实状态/动作）→ Wave 5/8。
- Glyth activity/注意力/LOD 形态精化 → Wave 8。
- density 阈值按 Zoomin 实测校准 → Wave 9。
- 其余 32 节点未绑定（图是混合画布）→ 不强行绑定，native fallback 正确语义。

## 下一 Wave 的直接输入

- Wave 4 就绪：Main + Global HUD（Figma hud 5388:27696）+ Railway（5385:283）+ Navigator 岛（5384:367）+ SurfaceDock 升级 + camera 左下 52 + Search/Focus；`Focus` 用的 `canonicalTargetResolver`/`focusOccurrence` 已从 Wave 0 就位；`locatorGeometry/state/arrivalState/spatialFocusPort` 已救回。
- SurfaceDock 需按 Figma 首页三现场 + Navigator hud 语义重排；Assembly 入口保持 GAP 禁用到 Wave 5。

## 回滚点

Wave 2 commit 之后；seam 可经 hostExtension.resolveNodeBody = undefined 一键回到 native；species 注册表与 nodeSpecies 纯逻辑可独立撤。
