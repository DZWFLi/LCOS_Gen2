import type { CoreEntityRefLike } from '../referenceBridge';

// R1 Semantic Drop Foundation — host-neutral target and intent types.
//
// These types describe a live interaction only. They are not a persistence
// model and must never become a second Canvas, Railway, Assembly, or Composer
// store. Canonical writes remain with Local Core, Huabu, and the reference
// store owners injected by dropCommitRouter.

import type {
  AssemblyApplyItemResultV1,
  AssemblySourceRefV1,
  AssemblyTargetRefV1,
  ProjectViewRailRefV0,
  RailwayCanonicalRefV1, RailwayReceiveOutcomeV1,
} from '@local-creative-os/contracts';
import type {
  DropPayload,
  DropDestination,
  SurfacePoint,
} from '@local-creative-os/web-gen2';

export type DropTargetKind =
  | 'railway-bookmark'
  | 'spatial-membership'
  | 'canvas'
  | 'railway-receive'
  | 'composer-reference'
  | 'collaboration-reference'
  | 'portal-receive'
  | 'collection-membership'
  | 'drop-exclusion'
  | 'external-import';

export interface DropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DropEntityRef extends CoreEntityRefLike {
  readonly displayLabel?: string;
}

export type DropTargetSemantic =
  | { readonly kind: 'railway-bookmark'; readonly projectId: string }
  | { readonly kind: 'spatial-membership'; readonly targetRef: AssemblyTargetRefV1 }
  | {
      readonly kind: 'canvas';
      readonly targetRef: AssemblyTargetRefV1;
    }
  | {
      readonly kind: 'railway-receive';
      /** Railway receive still uses Assembly apply; it never writes rail order. */
      readonly targetRef: AssemblyTargetRefV1;
      readonly destinationRef: ProjectViewRailRefV0 | RailwayCanonicalRefV1;
      readonly orderVersion?: number;
      readonly canvasId?: string;
      readonly accepts?: readonly string[];
    }
  | {
      /** Portal body is a named route into an existing workspace; it never reorders Railway. */
      readonly kind: 'portal-receive';
      readonly targetRef?: AssemblyTargetRefV1;
      readonly destinationRef?: RailwayCanonicalRefV1;
      readonly canvasId?: string;
    }
  | {
      /** A visible control that is explicitly not a drag receiver; blocks canvas fallback. */
      readonly kind: 'drop-exclusion';
      readonly reason: string;
    }
  | { readonly kind: 'collection-membership'; readonly collectionId: string }
  | {
      readonly kind: 'composer-reference';
      readonly intent?: 'continue' | 'delegate';
      readonly inputKey?: string;
    }
  | {
      /** Glyth body / user ruling 2026-09-27: durable context via existing Assembly apply. */
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
  /** Native source node identity, used only to exclude self-hit during a drag. */
  readonly nodeId?: string;
  readonly kind: DropTargetKind;
  readonly label: string;
  readonly rect: DropRect;
  /** Read current DOM geometry at hit-test time; transforms do not trigger ResizeObserver. */
  readonly readRect?: () => DropRect | undefined;
  /** Live occlusion test owned by the rendered receiver; never saved as truth. */
  readonly acceptsPoint?: (point: SurfacePoint) => boolean;
  readonly priority: number;
  readonly enabled: boolean;
  readonly ineligibleReason?: string;
  readonly semantic: DropTargetSemantic;
}

/** Resolver-only view of a live destination, without its ephemeral DOM geometry. */
export type DropTargetCandidate = Pick<DropTargetRegistration, 'targetId' | 'enabled' | 'ineligibleReason' | 'semantic'>;

export interface DropAssemblyApplyIntent {
  readonly kind: 'assembly-apply';
  readonly targetId: string;
  readonly targetRef: AssemblyTargetRefV1;
  readonly sourceRefs: readonly AssemblySourceRefV1[];
  readonly placementPoint?: SurfacePoint;
  readonly railwayReceive?: boolean;
  readonly portalReceive?: boolean;
  readonly railwayDestinationRef?: ProjectViewRailRefV0 | RailwayCanonicalRefV1;
  readonly railwayOrderVersion?: number;
  readonly railwayCanvasId?: string;
}

export interface DropComposerReferenceIntent {
  readonly kind: 'composer-reference';
  readonly targetId: string;
  readonly reference: DropEntityRef;
  readonly inputKey?: string;
  readonly intent?: 'continue' | 'delegate';
  /** An explicit multi-object gesture, ordered and de-duplicated by the resolver. */
  readonly references?: readonly DropEntityRef[];
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

export interface DropCollectionMembershipIntent {
  readonly kind: 'collection-membership';
  readonly targetId: string;
  readonly collectionId: string;
  readonly memberRef: { readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run'; readonly id: string };
  /** Same target, one explicit selection. Never silently submit a supported subset. */
  readonly memberRefs?: readonly DropCollectionMembershipIntent['memberRef'][];
}

export interface DropCollectionItemReceipt {
  readonly memberRef: DropCollectionMembershipIntent['memberRef'];
  readonly status: 'success' | 'partial' | 'failed';
  readonly message?: string;
  readonly canonicalReceipt?: unknown;
}

/** A spatial object is referenced by Rail; its contents and geometry stay with its owner. */
export interface DropRailwayBookmarkIntent {
  readonly kind: 'railway-bookmark';
  readonly targetId: string;
  readonly projectId: string;
  readonly refs: readonly RailwayCanonicalRefV1[];
}

export type DropIntent =
  | DropRailwayBookmarkIntent
  | DropAssemblyApplyIntent
  | DropComposerReferenceIntent
  | DropCollaborationReferenceIntent
  | DropCollectionMembershipIntent
  | DropExternalImportIntent;

export type DropResolution =
  | { readonly status: 'ready'; readonly intent: DropIntent }
  | {
      readonly status: 'ineligible';
      readonly targetId: string;
      readonly reason: string;
    };

export interface DropCommitReceipt {
  readonly status: 'success' | 'partial' | 'failed';
  readonly transactionId: string;
  readonly targetId: string;
  readonly message?: string;
  readonly canonicalReceipt?: unknown;
  readonly railwayReceipt?: RailwayReceiveOutcomeV1;
  readonly railwayOperationId?: string;
  readonly collectionItems?: readonly DropCollectionItemReceipt[];
  /** Derived display/retry scope only; the actual Core receipt remains untouched. */
  readonly assemblyItems?: readonly AssemblyApplyItemResultV1[];
  readonly projectId?: string;
  readonly unknownSourceKeys?: readonly string[];
  readonly retrySourceRefs?: readonly AssemblySourceRefV1[];
}

export type { DropDestination, DropPayload, SurfacePoint };
