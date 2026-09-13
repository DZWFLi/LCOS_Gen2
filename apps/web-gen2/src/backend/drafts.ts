// Sprint P0-03（T4/T6 consumer）：Command Draft + Composer submit projection typed HTTP facade（React-free）。
// draft 为跨 Surface 共享 Command State（surfaceKind: main/context/workflow/conversation），
// receiverId 由 T6 做 same-project 校验；提交投影（submissionKind/acknowledgement/allowedActions）由 T6 提供。

import type { ComposerSubmitProjectionV1, CommandDraftV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreDraftClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/command-drafts/:anchor → draft；无 draft 返回 null。 */
  getDraft(projectId: string, composerAnchor: string, workspaceId: string | null = null, signal?: AbortSignal): Promise<CommandDraftV1 | null> {
    const workspaceParam = workspaceId === null ? '' : `&workspaceId=${encodeURIComponent(workspaceId)}`;
    return coreRequest<CommandDraftV1 | null>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/command-drafts/${encodeURIComponent(composerAnchor)}?${workspaceParam}`,
      { signal },
    );
  }

  /** PUT /projects/:pid/command-drafts/:anchor → 保存/更新 draft（返回保存后的 draft）。 */
  saveDraft(projectId: string, composerAnchor: string, draft: Omit<CommandDraftV1, 'projectId' | 'composerAnchor' | 'updatedAt' | 'schemaVersion'>, signal?: AbortSignal): Promise<CommandDraftV1> {
    const workspaceParam = draft.workspaceId === null ? '' : `&workspaceId=${encodeURIComponent(draft.workspaceId)}`;
    return coreRequest<CommandDraftV1>(
      this.http,
      'PUT',
      `/projects/${encodeURIComponent(projectId)}/command-drafts/${encodeURIComponent(composerAnchor)}?${workspaceParam}`,
      { body: { ...draft, workspaceId: draft.workspaceId }, signal },
    );
  }

  /** DELETE /projects/:pid/command-drafts/:anchor → 清空草稿。 */
  deleteDraft(projectId: string, composerAnchor: string, workspaceId: string | null = null, signal?: AbortSignal): Promise<{ deleted: true }> {
    const workspaceParam = workspaceId === null ? '' : `&workspaceId=${encodeURIComponent(workspaceId)}`;
    return coreRequest<{ deleted: true }>(
      this.http,
      'DELETE',
      `/projects/${encodeURIComponent(projectId)}/command-drafts/${encodeURIComponent(composerAnchor)}?${workspaceParam}`,
      { signal },
    );
  }

  /** GET .../submit-projection → T6 composer submit projection（draft+receiver+receipt 聚合）。 */
  getComposerSubmitProjection(projectId: string, composerAnchor: string, workspaceId: string | null = null, signal?: AbortSignal): Promise<ComposerSubmitProjectionV1 | null> {
    const workspaceParam = workspaceId === null ? '' : `&workspaceId=${encodeURIComponent(workspaceId)}`;
    return coreRequest<ComposerSubmitProjectionV1 | null>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/command-drafts/${encodeURIComponent(composerAnchor)}/submit-projection?${workspaceParam}`,
      { signal },
    );
  }
}
