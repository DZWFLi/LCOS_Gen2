// Core Search typed HTTP boundary — calls the real project search route.
// GET /projects/:projectId/search?q=&limit=&types=&usedHereTarget=
// Returns SearchResultVNext as-is. NO rerank, NO scoring, NO semantic
// fallback, NO mixing Huabu RFS SEARCH into LCOS global results.

import type { SearchEntityTypeV0, SearchResultVNext } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export interface CoreSearchUsedHereTarget {
  kind: 'workspace' | 'scope' | 'conversation';
  id: string;
}

export interface CoreSearchParams {
  query: string;
  limit?: number;
  types?: SearchEntityTypeV0[];
  usedHereTarget?: CoreSearchUsedHereTarget;
}

export class CoreSearchClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:projectId/search -> SearchResultVNext (not normalized). */
  searchProject(projectId: string, params: CoreSearchParams): Promise<SearchResultVNext> {
    const parts: string[] = [`q=${encodeURIComponent(params.query)}`];
    if (params.limit !== undefined) parts.push(`limit=${encodeURIComponent(String(params.limit))}`);
    if (params.types !== undefined && params.types.length > 0) {
      parts.push(`types=${encodeURIComponent(params.types.join(','))}`);
    }
    if (params.usedHereTarget !== undefined) {
      parts.push(
        `usedHereTarget=${encodeURIComponent(`${params.usedHereTarget.kind}:${params.usedHereTarget.id}`)}`,
      );
    }
    return coreRequest<SearchResultVNext>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/search?${parts.join('&')}`,
    );
  }
}
