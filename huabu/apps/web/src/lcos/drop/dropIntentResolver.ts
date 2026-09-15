import type { AssemblySourceRefV1 } from '@local-creative-os/contracts';
import type { DropPayload } from '@local-creative-os/web-gen2';

import type {
  DropEntityRef,
  DropResolution,
  DropTargetRegistration,
} from './dropTypes';

function sourceRefForObject(
  payload: Extract<DropPayload, { kind: 'object' }>,
): AssemblySourceRefV1 | undefined {
  switch (payload.entityType) {
    case 'artifact':
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
    default:
      return undefined;
  }
}

function entityRefForPayload(payload: DropPayload): DropEntityRef | undefined {
  if (payload.kind === 'object') {
    return { entityType: payload.entityType, entityId: payload.entityId };
  }
  if (payload.kind === 'assembly') {
    return {
      entityType: payload.sourceRef.kind,
      entityId: payload.sourceRef.id,
    };
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
  target: DropTargetRegistration,
  reason: string,
): DropResolution {
  return { status: 'ineligible', targetId: target.targetId, reason };
}

/**
 * The single resolver used by both preview and commit. Callers must retain the
 * returned intent and pass that same object to the commit router.
 */
export function resolveDropIntent(
  payload: DropPayload,
  target: DropTargetRegistration,
): DropResolution {
  if (!target.enabled) {
    return ineligible(target, target.ineligibleReason ?? '此目标当前不可用');
  }

  if (target.semantic.kind === 'composer-reference') {
    const reference = entityRefForPayload(payload);
    return reference === undefined
      ? ineligible(target, '只有已有实体可以作为 Composer 引用')
      : {
          status: 'ready',
          intent: {
            kind: 'composer-reference',
            targetId: target.targetId,
            reference,
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

  return {
    status: 'ready',
    intent: {
      kind: 'assembly-apply',
      targetId: target.targetId,
      targetRef: target.semantic.targetRef,
      sourceRefs: [sourceRef],
      railwayReceive: true,
      railwayDestinationRef: target.semantic.destinationRef,
    },
  };
}
