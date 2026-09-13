// createLcosNodePresentationSeam — 全节点呈现 **唯一 junction**（R2）。
//
// 输入：nodeId + nativeType + data；输出：LCOS 物种 body 或 native fallback（undefined）。
// 单一性：
//   - 只有一个 resolve 入口（host extension → NodeBodyResolverContext → NodeWrapper/NoteNode）；
//   - 只有一个注册表（`lcosNodeCardRegistry`，机制来自 GEN1 nodeCardRegistry，B 级换壳）；
//   - 物种只来自真实事实：Core 绑定 entityType + reconcile 派生的 Core 元数据描述
//     （kind/受管/可用性/revision），绝不按 title/label 猜语义。
// 诚实回退：未绑定 / 物种不在注册表 → undefined（native body），不静默降级成别的物种。
// reactive：store 变更时 notify，late binding 就位后原位换 body（同节点 geometry 不变）。

import { resolveNodeSpeciesFromFacts } from '@local-creative-os/web-gen2';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { lcosNodeCardRegistry } from './lcosNodeCardRegistry';

import type { CanvasNodeBodySeam, CanvasNodeBodySlotInput } from '@/lcos-seam/types';

export function createLcosNodePresentationSeam(): CanvasNodeBodySeam {
  return {
    resolve(input: CanvasNodeBodySlotInput) {
      const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId);
      const descriptor = ref?.descriptor;
      const species = resolveNodeSpeciesFromFacts({
        ...(ref ? { entityType: ref.entityType } : {}),
        ...(descriptor?.artifactKind === undefined ? {} : { artifactKind: descriptor.artifactKind }),
        ...(descriptor?.managed === undefined ? {} : { managed: descriptor.managed }),
        ...(descriptor?.mimeType === undefined ? {} : { mimeType: descriptor.mimeType }),
        ...(descriptor?.sourceKind === undefined ? {} : { sourceKind: descriptor.sourceKind }),
        huabuNodeType: input.nodeType,
      });
      if (species === 'unknown') return undefined; // 不识 → native（不静默降级）
      const card = lcosNodeCardRegistry.resolveNodeCard(species);
      if (card === undefined) return undefined; // 未注册 → native（诚实回退）
      return card;
    },
    subscribe(listener: () => void) {
      return useLcosReferenceStore.subscribe(listener);
    },
  };
}
