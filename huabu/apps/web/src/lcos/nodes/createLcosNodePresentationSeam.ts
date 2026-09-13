// createLcosNodePresentationSeam — 全节点呈现 junction（binding-aware reactive seam）。
// 输入：nodeId + nativeType + data；输出：LCOS 物种 body 或 native fallback（undefined）。
// species 只来自 Core binding（reference store，reconcile 后填充），绝不按 title/label 猜。
// reactive：store 变更时 notify，late binding 就位后原位换 body（同节点 geometry 不变）。

import { resolveNodeSpeciesFromEntityType } from '@local-creative-os/web-gen2';


import { useLcosReferenceStore } from '../lcosReferenceState';
import { GlythNodeBody } from './GlythNodeBody';
import { NODE_SPECIES_BODY } from './LcosSpeciesBodies';
import { PortalNodeBody } from './PortalNodeBody';

import type { CanvasNodeBodySeam, CanvasNodeBodySlotInput } from '@/lcos-seam/types';

export function createLcosNodePresentationSeam(): CanvasNodeBodySeam {
  return {
    resolve(input: CanvasNodeBodySlotInput) {
      // 原生 Portal 节点（Huabu canvasRef + data.targetCanvasId）按构造就是 portal 物种：
      // Core 没有 portal 实体类型，这一物种的 producer 就是原生节点本身，不该等 Core 绑定。
      if (input.nodeType === 'canvasRef') return PortalNodeBody;
      const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId);
      if (!ref) return undefined; // unbound → 诚实 native fallback
      const species = resolveNodeSpeciesFromEntityType(ref.entityType);
      if (species === 'unknown') return undefined; // 绑定存在但 entityType 不识 → native + 诊断留痕
      // glyth 用带「双击打开工作台」的 body（Wave 8）；其余走统一物种注册表。
      if (species === 'glyth') return GlythNodeBody;
      return NODE_SPECIES_BODY[species];
    },
    subscribe(listener: () => void) {
      return useLcosReferenceStore.subscribe(listener);
    },
  };
}