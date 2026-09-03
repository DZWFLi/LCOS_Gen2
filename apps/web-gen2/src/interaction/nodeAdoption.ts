// Node adoption contract (Phase A audit P0-3).
//
// 审计 §4.2 / §12：任何 Huabu 原生能力与由 Huabu 创建的节点，只要进入 LCOS 的
// 引用、关系、内容、删除、drop、preview 或恢复链，就必须先获得真实 Core
// identity 与 ProjectionBinding；不得以 spatial id、label 或前端 store 冒充
// Domain Truth（禁止 `note:nodeId` 伪造）。
//
// 本模块是 pure resolver：把"Huabu 节点 identity"解析为"合法 CoreEntityRef"。
// resolve 失败时 fail-close（返回 { ok: false, reason }），由调用方给出可见
// 反馈，绝不猜测 entity type/id。adoption 的执行（真正导入 Core）属于 Core
// 侧 capability adapter（B00-R2b），Phase A 只建立契约与 fail-close 路径。

import type { CoreEntityRef } from '../spatial/relationProjection.js';

/** 一个可稳定解析为 CoreEntityRef 的节点 (spatial identity)。 */
export interface ResolvableNode {
  readonly spatialId: string;
}

export interface NodeResolutionResult {
  readonly ok: true;
  readonly entityRef: CoreEntityRef;
}
export interface NodeResolutionFailure {
  readonly ok: false;
  /** 用户可读的原因。 */
  readonly reason: string;
}
export type NodeResolution = NodeResolutionResult | NodeResolutionFailure;

/** 把 binding 中的 entity/store 视图解析为 CoreEntityRef。 */
export function bindingToCoreRef(input: {
  entityType: CoreEntityRef['entityType'] | string;
  entityId: string;
}): NodeResolution {
  if (!input.entityId || input.entityId === '') {
    return { ok: false, reason: 'binding carries an empty Core entity id' };
  }
  const type = input.entityType;
  const known: readonly string[] = [
    'artifact',
    'conversation',
    'skill',
    'run',
    'relation',
    'note',
    'scope',
    'view',
    'workspace',
  ];
  if (!known.includes(type)) {
    return {
      ok: false,
      reason: `binding entity type '${type}' is not a Core domain entity — refusing to fabricate a ref`,
    };
  }
  return {
    ok: true,
    entityRef: {
      entityType: type as CoreEntityRef['entityType'],
      entityId: input.entityId,
    },
  };
}

/**
 * Fail-close resolution: given a Huabu node and the binding lookup it yields,
 * produce a REAL CoreEntityRef or an explicit reason. Never fabricates a ref
 * from a spatial id. `bindingOrUndefined` may be undefined (native node without
 * a ProjectionBinding) — that is a refusal, not an adoption-by-guessing.
 */
export function resolveOrAdoptNode(
  _node: ResolvableNode,
  bindingOrUndefined?:
    | { entityType: CoreEntityRef['entityType'] | string; entityId: string }
    | null
    | undefined,
): NodeResolution {
  if (!bindingOrUndefined) {
    return {
      ok: false,
      reason:
        'native node has no ProjectionBinding — Core adoption required before it can be referenced (fail-close, no fabricated note ref)',
    };
  }
  return bindingToCoreRef(bindingOrUndefined);
}
