// Core Relation typed HTTP boundary — faithful to the real route.
// GET list / GET one / POST minimal create / PUT full Relation / DELETE.
// G0.6 decided createRelation: Core gains a minimal POST /projects/:id/
// relations so Core owns id/createdAt/updatedAt/validation/ChangeSet; the
// frontend only sends source/target/kind/origin (never authors a canonical
// Relation). PUT still requires a full Relation.

import type { Relation, RelationEntityType } from '@local-creative-os/domain';
import { HttpClient } from './client.js';
import { coreEnvelope, coreRequest } from './coreTypes.js';

export interface RelationPutResult {
  relation: Relation;
  changeSetId: string;
}

export interface RelationDeleteResult {
  changeSetId: string;
}

export interface RelationCreateInput {
  sourceEntityType: RelationEntityType;
  sourceEntityId: string;
  targetEntityType: RelationEntityType;
  targetEntityId: string;
  kind: string;
}

export interface RelationCreateResult {
  relation: Relation;
  changeSetId: string;
}

export class CoreRelationClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /projects/:projectId/relations — minimal create. Core generates
   * id/createdAt/updatedAt/validation/MutationSafety/ChangeSet. The frontend
   * only supplies the semantic intent (source/target/kind/origin).
   */
  createRelation(
    projectId: string,
    input: RelationCreateInput,
    origin?: unknown,
  ): Promise<RelationCreateResult> {
    const body = origin === undefined ? input : { ...input, origin };
    return coreEnvelope<Relation>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/relations`,
      { body },
    ).then((env) => {
      const meta = (env.meta ?? {}) as { changeSetId?: string };
      return { relation: env.value, changeSetId: meta.changeSetId ?? '' };
    });
  }

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
