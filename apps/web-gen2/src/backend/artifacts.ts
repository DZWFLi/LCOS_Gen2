// Core Artifact typed HTTP boundary — real artifact routes only.
// getArtifactDetail + listArtifactRevisions + searchArtifactTitles.
// Deliberately NOT createArtifact / listAll (the artifact route has no
// generic POST /artifacts, and search?q='' is 50-item title search, NOT a
// full project artifact list).

import type { Artifact, ArtifactRevision } from '@local-creative-os/domain';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export interface ArtifactRunRef {
  id: string;
  instruction: string | null;
  provider: string | null;
}

export interface ArtifactDetailRevision {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  run?: ArtifactRunRef;
}

/** Route-specific projection of GET /artifacts/:artifactId. */
export interface ArtifactDetailProjection {
  artifact: Artifact;
  currentRevisionId?: string;
  revisions: ArtifactDetailRevision[];
}

/** R4：单行 diff（Core 只对可读文本给出 diff；不可读时整段缺席）。 */
export interface RevisionCompareLineV1 {
  readonly type: 'same' | 'add' | 'remove';
  readonly text: string;
}

/**
 * Route-specific projection of GET /projects/:projectId/revisions/compare。
 * `contentAvailable` 为 false 时只有元数据可比 —— 呈现层必须如实说明，不得伪造 diff。
 */
export interface RevisionCompareResultV1 {
  readonly base: { readonly revisionId: string; readonly contentHash: string; readonly size: number; readonly mimeType: string };
  readonly head: { readonly revisionId: string; readonly contentHash: string; readonly size: number; readonly mimeType: string };
  readonly changed: boolean;
  readonly contentAvailable: boolean;
  readonly diff?: readonly RevisionCompareLineV1[];
}

export class CoreArtifactClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /artifacts/:artifactId. */
  getArtifactDetail(artifactId: string): Promise<ArtifactDetailProjection> {
    return coreRequest<ArtifactDetailProjection>(
      this.http,
      'GET',
      `/artifacts/${encodeURIComponent(artifactId)}`,
    );
  }

  /** GET /artifacts/:artifactId/revisions -> real ArtifactRevision[]. */
  listArtifactRevisions(artifactId: string): Promise<ArtifactRevision[]> {
    return coreRequest<ArtifactRevision[]>(
      this.http,
      'GET',
      `/artifacts/${encodeURIComponent(artifactId)}/revisions`,
    );
  }

  /**
   * 读取某个 FileRecord 的**真实字节内容**（Core 已实现的字节出口）。
   * `GET /projects/:projectId/file-records/:fileRecordId/content` → 原始字节 + FileRecord.mimeType。
   * 呈现层据此拿真实正文/图片；只读，不落库、不复制真值。
   */
  getFileRecordContent(projectId: string, fileRecordId: string, signal?: AbortSignal): Promise<Blob> {
    return this.http.getBlob(
      `/projects/${encodeURIComponent(projectId)}/file-records/${encodeURIComponent(fileRecordId)}/content`,
      signal,
    );
  }

  /** 同上，但按文本读出（仅供文本族预览；调用方自行限长）。 */
  getFileRecordText(projectId: string, fileRecordId: string, signal?: AbortSignal): Promise<string> {
    return this.http.getText(
      `/projects/${encodeURIComponent(projectId)}/file-records/${encodeURIComponent(fileRecordId)}/content`,
      signal,
    );
  }

  /**
   * GET /projects/:projectId/artifacts/search?q=... -> up to 50 artifact
   * title substring matches. Empty q returns the first 50 and MUST NOT be
   * treated as the full project artifact list (use ProjectGraphSnapshot).
   */
  searchArtifactTitles(projectId: string, q: string): Promise<Artifact[]> {
    const encoded = encodeURIComponent(q);
    return coreRequest<Artifact[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/artifacts/search?q=${encoded}`,
    );
  }

  /**
   * R4 Reader：真实 revision 对比（canonical owner = Core RuntimeRevisionCompareService）。
   * `GET /projects/:projectId/revisions/compare?base=&head=` → 元数据（hash/size/mime）+ changed
   * + 可选逐行 diff。`contentAvailable=false` 时只有元数据可比，呈现层必须如实说明，
   * 不得伪造行级差异。
   */
  compareRevisions(
    projectId: string,
    baseRevisionId: string,
    headRevisionId: string,
    signal?: AbortSignal,
  ): Promise<RevisionCompareResultV1> {
    const query = new URLSearchParams({ base: baseRevisionId, head: headRevisionId });
    return coreRequest<RevisionCompareResultV1>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/revisions/compare?${query.toString()}`,
      { signal },
    );
  }
}
