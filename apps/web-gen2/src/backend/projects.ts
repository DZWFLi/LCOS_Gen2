// Core Project typed HTTP boundary — only the routes LCOS Gen2 actually uses.
// listProjects + getProjectGraph. Does NOT fake create/delete/graph mutation
// (those are not part of the current Core->Huabu G0 loop).

import type { ProjectGraphSnapshot } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export interface ProjectListItem {
  id: string;
  name: string;
  rootPath: string;
  lastOpenedAt?: string;
}

export class CoreProjectClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects -> route-specific list item, not a full Domain Project. */
  listProjects(): Promise<ProjectListItem[]> {
    return coreRequest<ProjectListItem[]>(this.http, 'GET', '/projects');
  }

  /**
   * GET /projects/:projectId/graph -> ProjectGraphSnapshot | undefined.
   *
   * IMPORTANT: this snapshot still carries legacy spatial fields
   * (ArtifactView.position/size, Workspace.viewport/frameBounds). Those are
   * legacy data reads ONLY, and MUST NOT be used as Huabu Spatial Truth.
   */
  getProjectGraph(projectId: string): Promise<ProjectGraphSnapshot | undefined> {
    return coreRequest<ProjectGraphSnapshot | undefined>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/graph`,
    );
  }

  /** GET /projects/:projectId/workspaces -> 工作现场列表（含 stable canvasId；T2 C2-1D）。 */
  getWorkspaces(projectId: string, signal?: AbortSignal): Promise<readonly Workspace[]> {
    return coreRequest<readonly Workspace[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/workspaces`,
      { signal },
    );
  }

  /** PUT /projects/:projectId/workspaces/:id — 首次切换创建画布后回写 stable canvasId。 */
  updateWorkspaceCanvasId(
    projectId: string,
    workspaceId: string,
    canvasId: string,
    signal?: AbortSignal,
  ): Promise<Workspace> {
    return coreRequest<Workspace>(
      this.http,
      'PUT',
      `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      { signal, body: { canvasId } },
    );
  }
}
