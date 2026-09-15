# GEN2 ArtifactReader 真实内容接线 · 2026-09-15

## 任务摘要

把 `ArtifactReaderBody` 从只显示 Artifact/revision 元数据，接到现有 Local Core 文件内容读取接口。范围限定为文本/Markdown 和图片；未新增后端协议，也未把 `artifactId` 当 Huabu `nodeId`。

## 实际范围

- 详情先经 `CoreArtifactClient.getArtifactDetail`。
- 再经 `listArtifactRevisions` 解析 canonical revision 的 `fileRecordId`。
- 文本/Markdown 使用 `getFileRecordText(projectId, fileRecordId)`，以安全纯文本方式显示 Markdown 正文。
- 图片使用 `getFileRecordContent(projectId, fileRecordId)`，以 Blob URL 显示并在切换/卸载时释放。
- 校验详情 Artifact 属于当前 `projectId`，并防止 A→B 迟到响应覆盖当前窗口。
- presentation/pdf/other 保留诚实的“暂无可用正文读取通道”状态。

## 真实接口证据

- 前端：`apps/web-gen2/src/backend/artifacts.ts` 已存在 `getFileRecordText`、`getFileRecordContent`。
- Core：`apps/local-core/src/routes/projects.ts` 的 `GET /projects/:projectId/file-records/:fileRecordId/content` 校验 Project、FileRecord availability、大小，再返回原始字节和 MIME。
- 详情路由只投影 revision 元数据；正文必须通过完整 revision 取得 `fileRecordId`，因此没有复用不存在的正文字段。

## 修改文件

- `huabu/apps/web/src/lcos/professional/ArtifactReaderBody.tsx`

## 流程变化

```text
打开 Reader
→ GET artifact detail
→ GET canonical revisions
→ 解析 revision.fileRecordId
→ GET FileRecord content
→ 文本安全显示 / 图片 Blob URL 预览
```

## 验证

- `tsc -p huabu/apps/web/tsconfig.json --noEmit --pretty false`：通过。
- `eslint apps/web/src/lcos/professional/ArtifactReaderBody.tsx --report-unused-disable-directives --max-warnings 0`：通过；仅有仓库现存多 project 提示。
- `apps/web/src/lcos/professional/ArtifactReaderBody.test.tsx`：3 项通过，覆盖 `currentRevisionId` 非首项、A→B 迟到响应隔离、图片 Blob URL 卸载释放。
- 浏览器真实运行：未执行。

## 限制与风险

- Markdown 当前以安全 `<pre>` 纯文本渲染，未引入或启用新的 Markdown HTML 解析器。
- PDF/PPT/其它类型仍需既有 Preview Worker/Renderer 真实 producer，当前不伪造预览。
- 外部打开动作仍由既有宿主链路负责，本次不改 ProfessionalWindowStage/Shell/store。

## 回滚

回退 `ArtifactReaderBody.tsx` 即可；没有 schema、Core route、store 或协议迁移。
