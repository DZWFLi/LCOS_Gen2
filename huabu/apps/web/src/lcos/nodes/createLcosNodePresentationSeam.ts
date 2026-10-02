import { LcosCanvasTextBody } from './LcosCanvasTextBody';
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

import { resolveLcosNodeHostPresentation, resolveNodeSpeciesFromFacts, resolveVisualFamily } from '@local-creative-os/web-gen2';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { BoundNodeLoadingBody } from './BoundNodeLoadingBody';
import { lcosNodeCardRegistry } from './lcosNodeCardRegistry';

import type { CanvasNodeBodySeam, CanvasNodeBodySlotInput, CanvasNodeHostPresentation } from '@/lcos-seam/types';

// Stable snapshot: useSyncExternalStore must not receive a fresh object on every read.
const mediaBodyHost: CanvasNodeHostPresentation = { surface: 'media', showAiBadge: false, allowOverflow: true };
const collectionBodyHost: CanvasNodeHostPresentation = { surface: 'transparent', showAiBadge: false, allowOverflow: true };
const conversationHost = resolveLcosNodeHostPresentation({ entityType: 'conversation' });
const conversationBodyHost: CanvasNodeHostPresentation | undefined = conversationHost === undefined
  ? undefined
  : { ...conversationHost, selectionFeedback: 'body' };

export function createLcosNodePresentationSeam(): CanvasNodeBodySeam {
  return {
    resolve(input: CanvasNodeBodySlotInput) {
      const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId);
      const descriptor = ref?.descriptor;
      // Reuse the editor only for native text or an explicitly current, managed
      // text identity. Unknown bindings wait for metadata; historical/imported
      // and draft bodies must never briefly edit the current revision.
      const currentManagedText = ref?.entityType === 'artifact' && descriptor?.managed === true
        && (descriptor.artifactKind === 'markdown' || descriptor.artifactKind === 'text')
        && descriptor.revisionStatus !== 'draft'
        && (!descriptor.presentedRevisionId || descriptor.presentedRevisionId === descriptor.currentRevisionId);
      if (input.nodeType === 'text' && input.data?.contentMissing !== true && (!ref || currentManagedText)
        || (input.nodeType === 'note' && currentManagedText)) return LcosCanvasTextBody;

      if (ref !== undefined && descriptor === undefined && (ref.entityType === 'artifact' || ref.entityType === 'scope')) {
        return BoundNodeLoadingBody;
      }
      const species = resolveNodeSpeciesFromFacts({
        ...(ref ? { entityType: ref.entityType } : {}),
        ...(descriptor?.artifactKind === undefined ? {} : { artifactKind: descriptor.artifactKind }),
        ...(descriptor?.managed === undefined ? {} : { managed: descriptor.managed }),
        ...(descriptor?.revisionStatus === undefined ? {} : { revisionStatus: descriptor.revisionStatus }),
        ...(descriptor?.sourceRunId === undefined ? {} : { sourceRunId: descriptor.sourceRunId }),
        ...(descriptor?.mimeType === undefined ? {} : { mimeType: descriptor.mimeType }),
        ...(descriptor?.sourceKind === undefined ? {} : { sourceKind: descriptor.sourceKind }),
        huabuNodeType: input.nodeType,
      });
      if (species === 'unknown') return undefined; // 不识 → native（不静默降级）
      const card = lcosNodeCardRegistry.resolveNodeCard(species);
      if (card === undefined) return undefined; // 未注册 → native（诚实回退）
      return card;
    },
    resolveHostPresentation(input: CanvasNodeBodySlotInput) {
      const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId);
      if (!ref) return undefined;
      if (ref.entityType === 'conversation') return conversationBodyHost;
      if (ref.entityType === 'collection' || ref.entityType === 'run' || ref.entityType === 'result-slot') return collectionBodyHost;
      const descriptor = ref.descriptor;
      if (descriptor === undefined && (ref.entityType === 'artifact' || ref.entityType === 'scope')) return collectionBodyHost;
      // Collection faces own their silhouette; the native white note carrier must
      // not reappear behind the folder/book. Geometry and selection stay native.
      if (descriptor?.species === 'collection' || descriptor?.species === 'workflow-collection') {
        return collectionBodyHost;
      }
      const family = resolveVisualFamily({ entityType: ref.entityType, artifactKind: descriptor?.artifactKind, mimeType: descriptor?.mimeType, sourceKind: descriptor?.sourceKind, revisionStatus: descriptor?.revisionStatus });
      if (family === 'web' || family === 'video') return mediaBodyHost;
      return resolveLcosNodeHostPresentation({
        entityType: ref.entityType,
        ...(descriptor?.artifactKind === undefined ? {} : { artifactKind: descriptor.artifactKind }),
        ...(descriptor?.mimeType === undefined ? {} : { mimeType: descriptor.mimeType }),
        ...(descriptor?.sourceKind === undefined ? {} : { sourceKind: descriptor.sourceKind }),
        ...(descriptor?.managed === undefined ? {} : { managed: descriptor.managed }),
        ...(descriptor?.revisionStatus === undefined ? {} : { revisionStatus: descriptor.revisionStatus }),
      });
    },
    subscribe(listener: () => void) {
      return useLcosReferenceStore.subscribe(listener);
    },
  };
}
