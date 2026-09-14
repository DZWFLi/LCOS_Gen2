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
}
