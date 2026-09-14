// 投影节点内容落成（R2 返工）：把 Core 的真实字节搬进 Huabu 画布资产区，再写成节点 `data.src`。
//
// 为什么不能直接把 Core 的字节出口写进 `data.src`：
//   `GET /projects/:projectId/file-records/:fileRecordId/content` 需要
//   `Authorization: Bearer <token>`（见 `lcosHost.ts` 的 `coreToken`）。浏览器 `<img>` 的
//   请求头不由我们控制、不会带这个头，于是 Huabu 原生 ImageNode 只会渲染出"无图片来源"
//   的空白块 —— 这正是用户在 R2 视觉验收中否决的形态。
//
// 为什么走画布资产上传、拿"裸 key"：
//   `POST /api/canvas/<canvasId>/artifact/image` 把字节存成 `<artifactId><ext>`，
//   返回体的 `uri` 就是这个**裸 key**（服务端注释原话："`uri` carries only the artifact
//   key"）。节点 `data.src` 写裸 key，ImageNode 内部的 `resolveArtifactUrl` 会解析成
//   `/api/canvas/<canvasId>/artifact/<key>` —— 同源、无需 Core token。
//
// 这是"呈现层把真实内容搬进画布资产区"，不是复制域真值：
//   - 真值（Artifact / Revision / FileRecord 字节）仍在 Local Core；
//   - 画布资产区里的是画布侧的呈现副本，可随时由 Core 重建；
//   - 本模块只读 Core 字节、只写 Huabu 节点 `data.src`，**不做任何 Core 写操作**，
//     也不新建 store / 不改 ProjectionBinding。
//
// 覆盖范围（GAP，如实标注）：当前**只处理 image**。pdf / video / audio / office 的同类
// 落成依赖各自的 Huabu 节点形态与资产类型，尚未接线 —— 未接线即不可用，不假装支持。

import { HttpClient } from '@local-creative-os/web-gen2';

import { uploadImage } from '@/api/artifact';
import { readLcosHostConfig } from '@/lcos/lcosHost';
import useCanvasStore from '@/store/canvasStore';

type ProjectedSourceBinding = {
  readonly spatialId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly descriptor?: {
    readonly artifactKind?: string;
    readonly mimeType?: string;
    readonly fileRecordId?: string;
  };
};

/**
 * 已在途/已落成的节点内容（`<nodeId>:<fileRecordId>`）。
 *
 * 在途期间跳过重复调用；**成功后永久跳过**（重放 reconcile 不会重复上传字节）。
 * 失败时把键放行，允许下一次 reconcile 重试。模块级状态，页面重载即清空。
 */
const stagedSources = new Set<string>();

/**
 * 图片 MIME → 扩展名。服务端**按上传文件名的扩展名**决定存下来的 artifact key
 * （`artifact.route.ts`：`ext = path.extname(data.filename) || typeExtMap[type]`），
 * 而 HTTP 边界又按这个 key 的扩展名推断 `Content-Type`（`send-blob.ts` → `getMimeType`）。
 * 所以后缀必须与真实字节一致，否则图片会被当成 `application/octet-stream` 拒绝渲染。
 * 未收录的 MIME 退回 `.png`（与 `typeExtMap['image']` 的默认值一致）。
 */
const IMAGE_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
};

function imageExtensionFor(mimeType: string): string {
  const bare = mimeType.toLowerCase().split(';')[0].trim();
  return IMAGE_EXT_BY_MIME[bare] ?? '.png';
}

/** `data.src` 为空（缺省 / null / 空串）才需要落成；已有内容一律不覆盖。 */
function isEmptySource(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * 等这些节点 id 出现在画布 store 里。
 *
 * 为什么需要：投影是 RFS **服务端**写（reconcile 的 HTTP 调用返回时节点已在 Huabu 画布上），
 * 但浏览器 store 是通过画布同步异步收到的。紧随 reconcile 之后立刻读 store 可能还看不到新节点
 * （实测第一次落成读到 0 个候选节点）。这里事件驱动地等，且有上限，不阻塞打开。
 */
async function waitForNodesInStore(ids: readonly string[], timeoutMs: number): Promise<void> {
  const anyMissing = (): boolean => {
    const present = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
    return ids.some((id) => !present.has(id));
  };
  if (!anyMissing()) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    const unsubscribe = useCanvasStore.subscribe(() => {
      if (anyMissing()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/**
 * 为绑定的图片 artifact 落成画布内容，返回本次**真正落成**的节点数。
 *
 * 只处理：`entityType === 'artifact'` 且 `descriptor.artifactKind === 'image'` 且带
 * `descriptor.fileRecordId`。节点侧还要求：节点存在、`node.type === 'image'`、
 * `node.data.src` 为空。
 *
 * 绝不抛出：每个绑定独立 try/catch，失败只 warn 并继续下一个。
 */
export async function stageProjectedSources(
  projectId: string,
  bindings: readonly ProjectedSourceBinding[],
): Promise<number> {
  const candidates = bindings.filter(
    (binding) =>
      binding.entityType === 'artifact' &&
      binding.descriptor?.artifactKind === 'image' &&
      (binding.descriptor?.fileRecordId ?? '') !== '',
  );
  if (candidates.length === 0) return 0;
  if (import.meta.env.DEV) console.info(`[lcos] staging candidates: ${candidates.length}`);

  const canvasId = useCanvasStore.getState().canvasId;
  // 画布未就绪时没有资产区可落；不猜 id，留给下一次 reconcile。
  if (!canvasId) return 0;

  // 投影的服务端写入先于浏览器 store 同步到，这里等节点真的出现在 store 里再动手。
  await waitForNodesInStore(
    candidates.map((binding) => binding.spatialId),
    15000,
  );

  const config = readLcosHostConfig(
    import.meta.env as Record<string, string | undefined>,
  );
  let http: HttpClient | null = null;
  let staged = 0;

  for (const binding of candidates) {
    const fileRecordId = binding.descriptor?.fileRecordId;
    if (!fileRecordId) continue;

    // 每次重新读 store：前一个绑定的写入可能已经改变了节点数组。
    const node = useCanvasStore
      .getState()
      .nodes.find((candidate) => candidate.id === binding.spatialId);
    if (!node || node.type !== 'image' || !isEmptySource(node.data?.src)) continue;

    const dedupeKey = `${node.id}:${fileRecordId}`;
    if (stagedSources.has(dedupeKey)) continue;
    stagedSources.add(dedupeKey);

    try {
      if (!http) {
        http = new HttpClient({
          baseUrl: config.coreUrl,
          token: config.coreToken,
        });
      }
      const blob = await http.getBlob(
        `/projects/${encodeURIComponent(projectId)}/file-records/${encodeURIComponent(
          fileRecordId,
        )}/content`,
      );
      // 字节的 MIME 以 Core 响应头为准，其次用投影描述里的 mimeType。
      const mimeType = blob.type || binding.descriptor?.mimeType || 'image/png';
      const file = new File(
        [blob],
        `${fileRecordId}${imageExtensionFor(mimeType)}`,
        { type: mimeType },
      );
      const artifactKey = await uploadImage(file, canvasId);
      useCanvasStore.getState().updateNodeData(node.id, { src: artifactKey });
      staged += 1;
    } catch (error) {
      // 失败放行去重键：下次 reconcile 允许重试（只有成功才永久跳过）。
      stagedSources.delete(dedupeKey);
      console.warn(
        '[lcos] 节点内容落成失败',
        { nodeId: node.id, fileRecordId },
        error,
      );
    }
  }

  return staged;
}
