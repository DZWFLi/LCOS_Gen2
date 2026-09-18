// R6 ColorPin：颜色组（canonical color-pin owner）的 typed facade。
//
// 复用既有 canonical 路由（schema 48 + MutationSafety ChangeSet）：
//   GET    /projects/:pid/color-pins                       → ColorPinSnapshotV0
//   POST   /projects/:pid/color-pins/memberships           → { definition, membership } + ChangeSet
//   DELETE /projects/:pid/color-pins/memberships/:id       → { deleted, membershipId } + ChangeSet
//
// 纪律（与 navigation-marker 契约一致）：只透传 canonical identity（view / entity / surface）；
// 前端不复制坐标、不按 title/provider/time 模糊重绑、不建第二套 pin store。

import type { ColorPinMembershipV0, ColorPinDefinitionV0, ColorPinSnapshotV0, SpatialMarkerTargetRefV0 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreEnvelope, coreRequest, type CoreEnvelopeOk } from './coreTypes.js';

export interface ColorPinAssignInputV1 {
  readonly targetRef: SpatialMarkerTargetRefV0;
  /** 复用既有 definition；与 color 二选一。 */
  readonly colorPinId?: string;
  /** 新建/复用该颜色的 definition（#RRGGBB）。 */
  readonly color?: string;
  readonly label?: string;
}

export interface ColorPinMutationReceiptV1 {
  readonly definition: ColorPinDefinitionV0;
  readonly membership: ColorPinMembershipV0;
  readonly changeSetId?: string;
}

export interface ColorPinRemoveReceiptV1 {
  readonly deleted: boolean;
  readonly membershipId: string;
  readonly changeSetId?: string;
}

export class CoreColorPinClient {
  constructor(private readonly http: HttpClient) {}

  snapshot(projectId: string, signal?: AbortSignal): Promise<ColorPinSnapshotV0> {
    return coreRequest<ColorPinSnapshotV0>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/color-pins`,
      { signal },
    );
  }

  async assign(projectId: string, input: ColorPinAssignInputV1, signal?: AbortSignal): Promise<ColorPinMutationReceiptV1> {
    const envelope: CoreEnvelopeOk<{ definition: ColorPinDefinitionV0; membership: ColorPinMembershipV0 }> = await coreEnvelope(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/color-pins/memberships`,
      { body: input, signal },
    );
    const changeSetId = (envelope.meta as { changeSetId?: string } | undefined)?.changeSetId;
    return {
      definition: envelope.value.definition,
      membership: envelope.value.membership,
      ...(changeSetId === undefined ? {} : { changeSetId }),
    };
  }

  async removeMembership(projectId: string, membershipId: string, signal?: AbortSignal): Promise<ColorPinRemoveReceiptV1> {
    const envelope: CoreEnvelopeOk<{ deleted: boolean; membershipId: string }> = await coreEnvelope(
      this.http,
      'DELETE',
      `/projects/${encodeURIComponent(projectId)}/color-pins/memberships/${encodeURIComponent(membershipId)}`,
      { signal },
    );
    const changeSetId = (envelope.meta as { changeSetId?: string } | undefined)?.changeSetId;
    return {
      deleted: envelope.value.deleted,
      membershipId: envelope.value.membershipId,
      ...(changeSetId === undefined ? {} : { changeSetId }),
    };
  }
}