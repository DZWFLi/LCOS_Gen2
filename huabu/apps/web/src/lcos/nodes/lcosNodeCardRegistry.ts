// LCOS 节点卡片注册表（R2）：全应用**唯一**的物种 → 渲染器映射。
//
// 机制来自 GEN1 donor（B 级换壳，provenance 见 web-gen2 rendererRegistry.ts 的
// NodeCardRegistry 段）；此处是宿主侧的注册点。
// 规则：
//   - 每个物种只能有一个 owner（registry 内部拒绝重复注册，避免静默覆盖）；
//   - 未注册物种 → 由 junction 诚实回退 native body，不做静默降级；
//   - 这里不 import 任何 Core store，注册的只是纯呈现组件。

import { createNodeCardRegistry, type LcosNodeSpecies } from '@local-creative-os/web-gen2';

import { GlythNodeBody } from './GlythNodeBody';
import { speciesBodyFor } from './LcosSpeciesBodies';
import { PortalNodeBody } from './PortalNodeBody';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { ComponentType } from 'react';

export type LcosNodeCard = ComponentType<CanvasNodeBodySlotInput>;

/** 已被 Core 事实驱动可达的物种（其余物种在 registry 之外即 native fallback）。 */
export const LCOS_REGISTERED_SPECIES: readonly LcosNodeSpecies[] = [
  'source',
  'working',
  'draft',
  'context-reference',
  'run',
  'decision',
  'glyth',
  'collection',
  'workflow-collection',
  'portal',
  'prompt-frame',
  'unknown',
];

export const lcosNodeCardRegistry = createNodeCardRegistry<LcosNodeSpecies, LcosNodeCard>();

for (const species of LCOS_REGISTERED_SPECIES) {
  // glyth / portal 有各自的交互 body（打开工作台 / 打开入口预览），其余走统一物种 body。
  const card: LcosNodeCard =
    species === 'glyth' ? GlythNodeBody : species === 'portal' ? PortalNodeBody : speciesBodyFor(species);
  lcosNodeCardRegistry.registerNodeCard(species, card);
}
