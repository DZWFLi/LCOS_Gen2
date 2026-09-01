// Core Relation typed HTTP boundary — faithful to the real route.
// GET list / GET one / PUT full Relation / DELETE. NO fake createRelation
// ({kind,from,to}): the real route needs a full Relation (id/projectId/
// endpoints/kind/createdAt/updatedAt). Whether Core gets a minimal
// POST /projects/:id/relations is a G0.6 decision, not a frontend one.

import type { Relation } from '@local-creative-os/domain';
import { HttpClient } from './client.js';
import { coreEnvelope, coreRequest } from './coreTypes.js';

export interface RelationPutResult {
  relation: Relation;
  changeSetId: string;
}

export interface RelationDeleteResult {
  changeSetId: string;
}

export class CoreRelationClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:projectId/relations -> Relation[]. */
  listRelations(projectId: string): Promise<Relation[]> {
    return coreRequest<Relation[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/relations`,
    );
  }

  /** GET /projects/:projectId/relations/:relationId -> Relation. */
  getRelation(projectId: string, relationId: string): Promise<Relation> {
    return coreRequest<Relation>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/relations/${encodeURIComponent(relationId)}`,
    );
  }

  /**
   * PUT /projects/:projectId/relations/:relationId with a full Relation.
   * Body may be `{ relation, origin? }`. Returns the persisted Relation plus
   * the ChangeSet id from `meta.changeSetId`.
   */
  putRelation(
    projectId: string,
    relation: Relation,
    origin?: unknown,
  ): Promise<RelationPutResult> {
    const body = origin === undefined ? { relation } : { relation, origin };
    return coreEnvelope<Relation>(
      this.http,
      'PUT',
      `/projects/${encodeURIComponent(projectId)}/relations/${encodeURIComponent(relation.id)}`,
      { body },
    ).then((env) => {
      const meta = (env.meta ?? {}) as { changeSetId?: string };
      return { relation: env.value, changeSetId: meta.changeSetId ?? '' };
    });
  }

  /** DELETE /projects/:projectId/relations/:relationId (body optional/empty). */
  deleteRelation(
    projectId: string,
    relationId: string,
    origin?: unknown,
  ): Promise<RelationDeleteResult> {
    const body = origin === undefined ? {} : { origin };
    return coreEnvelope<null>(
      this.http,
      'DELETE',
      `/projects/${encodeURIComponent(projectId)}/relations/${encodeURIComponent(relationId)}`,
      { body },
    ).then((env) => {
      const meta = (env.meta ?? {}) as { changeSetId?: string };
      return { changeSetId: meta.changeSetId ?? '' };
    });
  }
}
