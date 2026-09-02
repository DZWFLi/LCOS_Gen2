// Renderer Registry (Phase A09): node type != domain taxonomy.
//
// 若每个 EntityType 都注册一个 node type，后续会爆炸并把视觉差异误当新语义。
// 使用少量 renderer FAMILY + presentation descriptor：family 决定“长什么样”，
// species 是呈现策略 key，只有 Core 已有 canonical difference 时才有必要区分。
//
// A09 只建立 descriptor 协议与 mapper（纯逻辑、可测），验证接线；真正的
// morphology 在 Phase B/C。Phase A 用 placeholder body 证明 renderer family
// 稳定、explicit mode 不创建新 entity/binding、unsupported 类型 fail-close。

import type { EntityType } from '../spatial/projectionBinding.js';
import type { SurfaceKeyName } from '../spatial/surfacePort.js';

/** 少量 renderer family —— node type 的上层。 */
export type RendererFamily =
  | 'lcos/entity'
  | 'lcos/conversation'
  | 'lcos/instrument'
  | 'lcos/external-file';

/**
 * species 是呈现策略 key —— 只有 Core 已有 canonical difference 时才使用。
 * summary / working / reading 不得放进 species（那是尺寸/缩放态，不是语义）。
 */
export type PresentationSpecies =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'skill'
  | 'run'
  | 'context-structure';

/** 一个 Core 实体 ref —— mapper 的输入。 */
export interface CoreEntityRefLoose {
  readonly type: EntityType;
  readonly id: string;
  readonly kind?: string;
  readonly title?: string;
}

/** 呈现描述符 —— host 据此挑 node type / species，而不是自己按 taxonomy 发散。 */
export interface PresentationDescriptor {
  readonly family: RendererFamily;
  readonly species: PresentationSpecies;
  readonly entity: CoreEntityRefLoose;
  readonly title: string;
  readonly capabilities: readonly NodeCapability[];
  /** placeholder：Phase A 只为验证接线；真实 morphology 在 Phase B/C。 */
  readonly preview?: unknown;
}

export type NodeCapability =
  | 'place'
  | 'compose'
  | 'reference'
  | 'connect'
  | 'inspect'
  | 'edit';

const familyCapabilities: Readonly<Record<RendererFamily, readonly NodeCapability[]>> = {
  'lcos/entity': ['place', 'reference', 'connect', 'edit'],
  'lcos/conversation': ['place', 'reference', 'connect', 'compose'],
  'lcos/instrument': ['place', 'compose', 'inspect'],
  'lcos/external-file': ['place', 'reference'],
};

function speciesFor(entity: CoreEntityRefLoose): {
  species: PresentationSpecies;
  family: RendererFamily;
} {
  if (entity.type === 'artifact') {
    switch (entity.kind) {
      case 'image':
        return { species: 'image', family: 'lcos/entity' };
      case 'audio':
        return { species: 'audio', family: 'lcos/entity' };
      case 'video':
        return { species: 'video', family: 'lcos/entity' };
      case 'pdf':
        return { species: 'pdf', family: 'lcos/entity' };
      case 'file':
        return { species: 'text', family: 'lcos/external-file' };
      default:
        return { species: 'text', family: 'lcos/entity' };
    }
  }
  if (entity.type === 'conversation') {
    return entity.kind === 'context'
      ? { species: 'context-structure', family: 'lcos/conversation' }
      : { species: 'text', family: 'lcos/conversation' };
  }
  if (entity.type === 'skill') {
    return { species: 'skill', family: 'lcos/instrument' };
  }
  if (entity.type === 'run') {
    return { species: 'run', family: 'lcos/instrument' };
  }
  return { species: 'text', family: 'lcos/entity' };
}

/**
 * Map a Core entity to its presentation descriptor (A09 mapper Pillar).
 * unsupported type fail-close 为中性 unknown presentation（仍可渲染），
 * 但不自行造新 type —— 绝不会返回一个不存在的 family/species。
 */
export function descriptorFor(entity: CoreEntityRefLoose): PresentationDescriptor {
  const { family, species } = speciesFor(entity);
  return {
    family,
    species,
    entity,
    title: entity.title ?? (entity.type === 'artifact' ? 'artifact' : entity.type),
    capabilities: [...(familyCapabilities[family] ?? [])],
    preview: undefined,
  };
}

/** 一个 surface 现场可投递哪些 renderer family（A09 / A08 交叉校验）。 */
export function familiesFor(surface: SurfaceKeyName): readonly RendererFamily[] {
  switch (surface) {
    case 'context':
      return ['lcos/conversation', 'lcos/entity'];
    case 'workflow':
      return ['lcos/instrument', 'lcos/conversation'];
    default:
      return ['lcos/entity', 'lcos/conversation', 'lcos/instrument', 'lcos/external-file'];
  }
}
