// R1 Semantic Drop Foundation — host-neutral target and intent types.
//
// These types describe a live interaction only. They are not a persistence
// model and must never become a second Canvas, Railway, Assembly, or Composer
// store. Canonical writes remain with Local Core, Huabu, and the reference
// store owners injected by dropCommitRouter.

import type {
  AssemblySourceRefV1,
  AssemblyTargetRefV1,
  ProjectViewRailRefV0,
} from '@local-creative-os/contracts';
import type {
  DropPayload,
  DropDestination,
  SurfacePoint,
} from '@local-creative-os/web-gen2';

export type DropTargetKind =
  | 'canvas'
  | 'railway-receive'
  | 'composer-reference'
  | 'collaboration-reference'
  | 'external-import';

export interface DropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DropEntityRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly displayLabel?: string;
}

export type DropTargetSemantic =
  | {
      readonly kind: 'canvas';
      readonly targetRef: AssemblyTargetRefV1;
    }
  | {
      readonly kind: 'railway-receive';
      /** Railway receive still uses Assembly apply; it never writes rail order. */
      readonly targetRef: AssemblyTargetRefV1;
      readonly destinationRef: ProjectViewRailRefV0;
    }
  | {
      readonly kind: 'composer-reference';
    }
  | {
      /** CollaborationTarget（收敛方案 V1 §15）：Drop 到 Glyth = 作为 Reference 交给该 Conversation。 */
      readonly kind: 'collaboration-reference';
      readonly conversationId: string;
    }
  | {
      readonly kind: 'external-import';
      readonly owner: 'capture' | 'import';
    };

/** A registered live target. The registry is ephemeral and gesture-scoped. */
export interface DropTargetRegistration {
  readonly targetId: string;
  readonly kind: DropTargetKind;
  readonly label: string;
  readonly rect: DropRect;
  readonly priority: number;
  readonly enabled: boolean;
  readonly ineligibleReason?: string;
  readonly semantic: DropTargetSemantic;
}

export interface DropAssemblyApplyIntent {
  readonly kind: 'assembly-apply';
  readonly targetId: string;
  readonly targetRef: AssemblyTargetRefV1;
  readonly sourceRefs: readonly AssemblySourceRefV1[];
  readonly placementPoint?: SurfacePoint;
  readonly railwayReceive?: boolean;
  readonly railwayDestinationRef?: ProjectViewRailRefV0;
}

export interface DropComposerReferenceIntent {
  readonly kind: 'composer-reference';
  readonly targetId: string;
  readonly reference: DropEntityRef;
}

export interface DropExternalImportIntent {
  readonly kind: 'external-import';
  readonly targetId: string;
  readonly owner: 'capture' | 'import';
  readonly payload: Extract<DropPayload, { kind: 'file' | 'text' | 'url' }>;
}

/**
 * CollaborationTarget intent（preview = execute）：
 * 把已有实体作为 Reference 交给「该 Conversation」——preview 与 commit
 * 使用同一 intent 对象（resolver 注释已约定调用方保留原对象），下游不再弹二次操作选择窗。
 */
export interface DropCollaborationReferenceIntent {
  readonly kind: 'collaboration-reference';
  readonly targetId: string;
  readonly conversationId: string;
  readonly reference: DropEntityRef;
}

export type DropIntent =
  | DropAssemblyApplyIntent
  | DropComposerReferenceIntent
  | DropCollaborationReferenceIntent
  | DropExternalImportIntent;

export type DropResolution =
  | { readonly status: 'ready'; readonly intent: DropIntent }
  | {
      readonly status: 'ineligible';
      readonly targetId: string;
      readonly reason: string;
    };

export interface DropCommitReceipt {
  readonly status: 'success' | 'failed';
  readonly transactionId: string;
  readonly targetId: string;
  readonly message?: string;
  readonly canonicalReceipt?: unknown;
}

export type { DropDestination, DropPayload, SurfacePoint };
