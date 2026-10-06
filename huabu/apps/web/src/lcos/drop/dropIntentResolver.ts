import { draftReferenceForGesture, draftReferenceUnavailableReason } from '../composer/referenceSnapshot';
import { draftReferenceKey } from '../referenceBridge';
import { railwayStableKeyV1, type AssemblySourceRefV1, type RailwayCanonicalRefV1 } from '@local-creative-os/contracts';
import type { DropPayload } from '@local-creative-os/web-gen2';

import type {
  DropEntityRef,
  DropResolution,
  DropTargetCandidate,
  DropTargetRegistration,
} from './dropTypes';

function sourceRefForObject(
  payload: Extract<DropPayload, { kind: 'object' }>,
): AssemblySourceRefV1 | undefined {
  switch (payload.entityType) {
    case 'artifact':
      return payload.artifactViewId ? { kind: 'artifactView', id: payload.artifactViewId } : undefined;
    case 'view':
    case 'artifactView':
      return { kind: 'artifactView', id: payload.entityId };
    case 'note':
    case 'resource':
    case 'conversation':
    case 'context':
    case 'workflow':
    case 'scene':
    case 'collection':
      return { kind: payload.entityType, id: payload.entityId };
    case 'workspace':
      return { kind: 'scene', id: payload.entityId };
    default:
      return undefined;
  }
}

function railwayBookmarkRef(projectId: string, kind: string, id: string): RailwayCanonicalRefV1 | undefined {
  if (!projectId.trim() || !id.trim()) return undefined;
  if (kind === 'scene' || kind === 'workspace') return { kind: 'worksite', projectId, worksiteId: id };
  if (kind === 'context' || kind === 'workflow' || kind === 'scope')
    return { kind: 'spatial', projectId, entityType: 'scope', entityId: id };
  if (kind === 'collection') return { kind: 'spatial', projectId, entityType: 'collection', entityId: id };
  return undefined;
}

function railwayBookmarkRefForAssembly(
  payload: Extract<DropPayload, { readonly kind: 'assembly' }>,
  projectId: string,
): RailwayCanonicalRefV1 | undefined {
  const expectedEntityType = payload.sourceRef.kind === 'scene' ? 'workspace'
    : payload.sourceRef.kind === 'context' || payload.sourceRef.kind === 'workflow' ? 'scope'
      : payload.sourceRef.kind === 'collection' ? 'collection' : undefined;
  if (!expectedEntityType || (payload.entityRef && (payload.entityRef.type !== expectedEntityType || payload.entityRef.id !== payload.sourceRef.id))) return undefined;
  return railwayBookmarkRef(projectId, payload.sourceRef.kind, payload.sourceRef.id);
}

function resolveRailwayBookmark(payload: DropPayload, target: DropTargetCandidate): DropResolution {
  const semantic = target.semantic;
  if (semantic.kind !== 'railway-bookmark') return ineligible(target, '目标尚未确认Railway收藏写入');
  const projectId = semantic.projectId;
  let refs: readonly (RailwayCanonicalRefV1 | undefined)[];
  if (payload.kind === 'assembly') refs = [railwayBookmarkRefForAssembly(payload, projectId)];
  else if (payload.kind === 'object') refs = [railwayBookmarkRef(projectId, payload.entityType, payload.entityId)];
  else if (payload.kind === 'objects') refs = payload.objects.map((object) => railwayBookmarkRef(projectId, object.entityType, object.entityId));
  else return ineligible(target, 'Railway只保存聚合空间引用；材料、笔记、文件和文本不会加入导航');

  if (refs.length === 0 || refs.some((ref) => ref === undefined))
    return ineligible(target, '整组未保存：Railway只接受Scene、Context、Workflow或Collection聚合引用');
  const unique = [...new Map((refs as readonly RailwayCanonicalRefV1[]).map((ref) => [railwayStableKeyV1(ref), ref])).values()];
  if (!unique.length) return ineligible(target, '没有可加入Railway的聚合引用');
  return { status: 'ready', intent: { kind: 'railway-bookmark', targetId: target.targetId, projectId, refs: unique } };
}

function entityRefForPayload(payload: DropPayload): DropEntityRef | undefined {
  if (payload.kind === 'object') {
    if (!payload.entityId.trim()) return undefined;
    const ref = draftReferenceForGesture(payload);
    // Preserve the old View-address shape only when no precise revision has been captured.
    return ref.entityType === 'artifact' && ref.artifactViewId && !ref.revisionId
      ? { entityType: 'artifactView', entityId: ref.artifactViewId,
          ...(ref.mode ? { mode: ref.mode } : {}), ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
          ...(ref.displayLabel ? { displayLabel: ref.displayLabel } : {}) } : ref;
  }
  if (payload.kind === 'assembly') {
    const reference = payload.reference;
    if (reference) {
      // Do not trust a row reference for a different source. It must describe the same View/entity.
      const sourceId = reference.entityType === 'artifact' ? reference.artifactViewId
        : ['view', 'artifactView'].includes(reference.entityType) ? reference.entityId : undefined;
      if (payload.sourceRef.kind === 'artifactView') {
        if (sourceId !== payload.sourceRef.id || (payload.entityRef?.type === 'artifact'
          && (reference.entityType === 'artifact' ? reference.entityId : reference.artifactId) !== payload.entityRef.id)) return undefined;
      } else if (reference.entityId !== payload.sourceRef.id) return undefined;
      return draftReferenceForGesture(reference);
    }
    return { entityType: payload.sourceRef.kind, entityId: payload.sourceRef.id };
  }
  return undefined;
}

function assemblySourceRefForPayload(
  payload: DropPayload,
): AssemblySourceRefV1 | undefined {
  if (payload.kind === 'object') return sourceRefForObject(payload);
  if (payload.kind === 'assembly') return payload.sourceRef;
  return undefined;
}

function ineligible(
  target: DropTargetCandidate,
  reason: string,
): DropResolution {
  return { status: 'ineligible', targetId: target.targetId, reason };
}

/** Resolve every selected source against the same receiver before admitting any write. */
function resolveObjects(payload: Extract<DropPayload, { kind: 'objects' }>, target: DropTargetCandidate): DropResolution {
  if (payload.objects.length === 0) return ineligible(target, '所选对象尚无可验证的项目身份，不能投递');
  const resolutions = payload.objects.map((object) => resolveDropIntent({ kind: 'object', ...object }, target));
  const rejected = resolutions.find((item) => item.status === 'ineligible');
  if (rejected?.status === 'ineligible') return ineligible(target, `整组未投递：${rejected.reason}`);
  const intents = resolutions.flatMap((item) => item.status === 'ready' ? [item.intent] : []);
  const first = intents[0];
  if (!first) return ineligible(target, '没有可投递的对象');
  const unique = <T,>(values: readonly T[], key: (value: T) => string): T[] =>
    [...new Map(values.map((value) => [key(value), value])).values()];
  if (first.kind === 'collection-membership') {
    const members = intents.flatMap((intent) => intent.kind === 'collection-membership' ? [intent.memberRef] : []);
    return { status: 'ready', intent: { ...first, memberRefs: unique(members, (ref) => `${ref.type}:${ref.id}`) } };
  }
  if (first.kind === 'composer-reference') {
    const refs = intents.flatMap((intent) => intent.kind === 'composer-reference' ? [intent.reference] : []);
    return { status: 'ready', intent: { ...first, references: unique(refs, draftReferenceKey) } };
  }
  if (first.kind === 'assembly-apply') {
    const refs = intents.flatMap((intent) => intent.kind === 'assembly-apply' ? intent.sourceRefs : []);
    return { status: 'ready', intent: { ...first, sourceRefs: unique(refs, (ref) => `${ref.kind}:${ref.id}`) } };
  }
  return ineligible(target, '该目标不能接收一组项目对象');
}

/**
 * The single resolver used by both preview and commit. Callers must retain the
 * returned intent and pass that same object to the commit router.
 */
export function resolveDropIntent(payload: DropPayload, target: DropTargetRegistration): DropResolution;
export function resolveDropIntent(payload: DropPayload, target: DropTargetCandidate): DropResolution;
export function resolveDropIntent(
  payload: DropPayload,
  target: DropTargetCandidate,
): DropResolution {
  if (!target.enabled) return ineligible(target, target.ineligibleReason ?? '此目标当前不可用');
  if (target.semantic.kind === 'railway-bookmark') return resolveRailwayBookmark(payload, target);
  if (payload.kind === 'objects') return resolveObjects(payload, target);

  if (target.semantic.kind === 'drop-exclusion') {
    return ineligible(target, target.semantic.reason);
  }

  if (target.semantic.kind === 'collection-membership') {
    const ref = payload.kind === 'object'
      ? { type: payload.entityType, id: payload.entityId }
      : payload.kind === 'assembly'
        ? payload.entityRef ?? { type: payload.sourceRef.kind, id: payload.sourceRef.id }
        : undefined;
    const supported = new Set(['artifact', 'note', 'collection', 'scope', 'workspace', 'conversation', 'run']);
    if (ref === undefined || !supported.has(ref.type) || ref.id.trim() === '') {
      return ineligible(target, '此来源没有可验证的 canonical 实体身份，不能加入集合');
    }
    if (ref.type === 'collection' && ref.id === target.semantic.collectionId) {
      return ineligible(target, '不能把集合加入自身');
    }
    return {
      status: 'ready',
      intent: {
        kind: 'collection-membership',
        targetId: target.targetId,
        collectionId: target.semantic.collectionId,
        memberRef: { type: ref.type as 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run', id: ref.id },
      },
    };
  }

  if (target.semantic.kind === 'composer-reference') {
    const reference = entityRefForPayload(payload);
    const reason = draftReferenceUnavailableReason(reference, target.semantic.intent);
    return reference === undefined || reason !== undefined
      ? ineligible(target, reason ?? '只有已有实体可以作为 Composer 引用')
      : {
          status: 'ready',
          intent: {
            kind: 'composer-reference',
            targetId: target.targetId,
            reference,
            ...(target.semantic.inputKey ? { inputKey: target.semantic.inputKey } : {}),
            ...(target.semantic.intent ? { intent: target.semantic.intent } : {}),
          },
        };
  }

  if (target.semantic.kind === 'collaboration-reference') {
    // User ruling 2026-09-27 / original T3 §17: body = durable conversation context.
    // Reuse the canonical Assembly owner; Composer alone receives temporary refs.
    const sourceRef = assemblySourceRefForPayload(payload);
    if (sourceRef === undefined) {
      return ineligible(target, '此材料尚无可绑定的真实来源，请等待投影就绪');
    }
    return {
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        targetId: target.targetId,
        targetRef: { kind: 'conversation', id: target.semantic.conversationId },
        sourceRefs: [sourceRef],
      },
    };
  }

  if (target.semantic.kind === 'external-import') {
    if (
      payload.kind !== 'file' &&
      payload.kind !== 'text' &&
      payload.kind !== 'url'
    ) {
      return ineligible(target, '此目标只接收文件、文本或链接');
    }
    return {
      status: 'ready',
      intent: {
        kind: 'external-import',
        targetId: target.targetId,
        owner: target.semantic.owner,
        payload,
      },
    };
  }

  const sourceRef = assemblySourceRefForPayload(payload);
  if (sourceRef === undefined) {
    return ineligible(target, '该来源没有可写入 Core 的实体引用');
  }

  if (target.semantic.kind === 'spatial-membership') {
    const targetRef = target.semantic.targetRef;
    if (sourceRef.kind === 'scene' && (targetRef.kind === 'workspace' || targetRef.kind === 'scene'))
      return ineligible(target, '工作现场不能加入另一个工作现场；请投到主画布、Context、Workflow或Collection。');
    if ((sourceRef.kind === 'context' && targetRef.kind === 'context'
      || sourceRef.kind === 'workflow' && targetRef.kind === 'workflow') && sourceRef.id === targetRef.id)
      return ineligible(target, '不能把聚合对象加入自身');
    return { status: 'ready', intent: { kind: 'assembly-apply', targetId: target.targetId,
      targetRef, sourceRefs: [sourceRef] } };
  }

  // Core v0.15 explicitly does not admit an aggregate Scene into another
  // Scene working set. Reject the exact Canvas target before claiming a ready
  // preview; Main/Context/Workflow surface and Conversation remain supported.
  if (target.semantic.kind === 'canvas' && sourceRef.kind === 'scene'
    && (target.semantic.targetRef.kind === 'workspace' || target.semantic.targetRef.kind === 'scene')) {
    return ineligible(target, '一个现场不能直接加入另一个现场；请拖到 Main、Context、Workflow 根或会话。');
  }

  if (target.semantic.kind === 'canvas') {
    return {
      status: 'ready',
      intent: {
        kind: 'assembly-apply',
        targetId: target.targetId,
        targetRef: target.semantic.targetRef,
        sourceRefs: [sourceRef],
      },
    };
  }

  if (target.semantic.kind === 'portal-receive') {
    const semantic = target.semantic;
    if (semantic.targetRef?.kind !== 'workspace' || semantic.destinationRef?.kind !== 'worksite'
      || semantic.targetRef.id !== semantic.destinationRef.worksiteId || !semantic.canvasId) {
      return ineligible(target, '入口尚未确认原工作现场，请重新打开入口');
    }
    if (!['artifactView', 'note'].includes(sourceRef.kind))
      return ineligible(target, '该类型尚不能整批投递到入口；选中材料不会被拆开发送');
    return {status: 'ready', intent: {
      kind: 'assembly-apply', targetId: target.targetId, targetRef: semantic.targetRef, sourceRefs: [sourceRef],
      portalReceive: true, railwayDestinationRef: semantic.destinationRef, railwayCanvasId: semantic.canvasId,
    }};
  }

  if (target.semantic.accepts && !target.semantic.accepts.includes(sourceRef.kind))
    return ineligible(target, '该类型尚不能原子投递到现场；整组选中材料不会被拆开发送');
  return {
    status: 'ready',
    intent: {
      kind: 'assembly-apply',
      targetId: target.targetId,
      targetRef: target.semantic.targetRef,
      sourceRefs: [sourceRef],
      ...(target.semantic.orderVersion === undefined ? {} : {railwayOrderVersion:target.semantic.orderVersion}),
      ...(target.semantic.canvasId === undefined ? {} : {railwayCanvasId:target.semantic.canvasId}),
      railwayReceive: true,
      railwayDestinationRef: target.semantic.destinationRef,
    },
  };
}
