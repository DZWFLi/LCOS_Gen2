// Core Project typed HTTP boundary — only the routes LCOS Gen2 actually uses.
// listProjects + getProjectGraph. Does NOT fake create/delete/graph mutation
// (those are not part of the current Core->Huabu G0 loop).

import type { ProjectGraphSnapshot } from '@local-creative-os/contracts';
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
}
