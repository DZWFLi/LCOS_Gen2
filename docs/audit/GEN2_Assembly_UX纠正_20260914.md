# GEN2 Assembly UX 纠正回执

日期：2026-09-14
范围：`huabu/apps/web/src/lcos/professional/AssemblyBody.tsx` 与专属测试

## 结论

Assembly 已按 Figma `5202:369` / 第 13 页专项收敛为内容优先瀑布流。真实仓库读取、Composer 草稿、Core `apply` 投放和回执均保留；动作收进悬停/聚焦态，卡片不再常驻三枚大按钮。会话条目进入 conversation work view；artifact 进入 Reader；context/workflow/scene 进入已有 Portal partial preview；resource/note/collection 没有当前 body 可消费的 canonical target，明确显示暂不可打开。

## 变更

- 将等高 `grid-cols-2` 改为响应式 CSS columns 瀑布流，保留滚动容器和条目语义属性。
- 增加 `visualFamily` / entity kind 的形态标签与图标，区分图像、音视频、文本、集合/现场等材料家族。
- 只有 Core 提供 `previewRef` 时才渲染真实 `<img>`；没有预览时明确显示“暂无真实预览”，未造假缩略图。
- `previewRef` 只有在 `http(s)`、`blob:` 或 `data:image/` 形式时才交给 `<img>`；opaque ID 会回退为无预览提示。
- 草稿、阅读/会话、投放动作只在条目悬停或键盘聚焦时出现；触控/粗指针设备通过 media query 保持取用工具行可见；卡片本身可聚焦，键盘可进入动作。
- `conversation` 打开 `conversation` 窗口；`artifact` 打开 `reader`；context/workflow/scene 进入已有 `portal-preview`；resource/note/collection 明确不可打开。
- 修正瀑布流滚动层级：外层负责 `max-height + overflow-y`，内层 columns 不限高，避免 12 项只露顶端两张和横向空白分栏。
- 无真实预览的材料不再统一渲染大灰色占位；仅真实图片保留预览比例框，文本/其他材料用紧凑图标和标题形态。
- 保留 target-aware apply、partial receipt、部分失败的用户可读回执和已有 source identity 映射。

## Figma 对照

- `5202:369`：主视觉在前、卡片高度随内容变化、瀑布流阅读节奏。
- 第 13 页 `5346:1416` / `5346:1666` / `5346:1885`：搜索、悬停取用、搜索结果状态。
- 第 13 页取用动作：当前会话/现场关系继续由现有 Composer、Professional Window 和 apply owner 承接，本次没有新增第二套 truth。

## 验证

- `npm run typecheck --prefix huabu/apps/web`：通过。
- 浏览器复测：瀑布流滚动层级已调整为外层滚动、内层不限高；缺预览材料改为紧凑卡头，图片预览保持比例。
- `npm exec vitest -- --config huabu/apps/web/vitest.config.ts run src/lcos/professional/AssemblyBody.test.ts`：未执行到测试；当前仓库运行环境缺少 `happy-dom`，且该配置从仓库根执行时会尝试加载 Huabu 旧 `/src` 入口。记录为环境阻塞，不冒充通过。
- `npm exec vitest run huabu/apps/web/src/lcos/professional/AssemblyBody.test.ts`：同样被现有 `@local-creative-os/web-gen2` package entry 解析阻塞。

## 未完成与风险

- 当前 contracts 只提供 `previewRef` 字符串，没有可验证的 preview producer/URL 解析通道；组件只接受明确 URL 形态，opaque ref 诚实显示缺预览，不能在本组件内补造图片。
- 本次没有改 Professional Window、Shell、Store、Stage、Core schema 或 apply owner。
- 工作区已有其它 diff，未覆盖、未提交、未推送。

## 回滚

只需回滚本报告、`AssemblyBody.tsx` 和 `AssemblyBody.test.ts` 的本次差异；不涉及数据库、迁移或外部系统。
