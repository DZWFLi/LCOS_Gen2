import { railwayStableKeyV1 } from '@local-creative-os/contracts';
import type { CoreRailwayClient } from '@local-creative-os/web-gen2';
import type { DropRailwayBookmarkIntent } from './dropTypes';

/** Reuse Core's order row and CAS. Only references are saved; no members or geometry move. */
export async function bookmarkRailway(
  client: Pick<CoreRailwayClient,'snapshot'|'save'>,
  intent: DropRailwayBookmarkIntent,
  current: () => boolean,
  signal?: AbortSignal,
) {
  if (!current() || signal?.aborted) throw new Error('项目已经切换或拖放已取消');
  const snapshot=await client.snapshot(intent.projectId,signal);
  if (!current() || signal?.aborted || snapshot.projectId!==intent.projectId || snapshot.order.projectId!==intent.projectId)
    throw new Error('项目已变化，未固定空间');
  const refs=[...snapshot.order.orderedRefs];
  const keys=new Set(refs.map(railwayStableKeyV1));
  for(const ref of intent.refs) {
    if(ref.projectId!==intent.projectId) throw new Error('不能把其他项目的空间固定到这里');
    const key=railwayStableKeyV1(ref);
    if(!keys.has(key)) {refs.push(ref);keys.add(key);}
  }
  if(refs.length===snapshot.order.orderedRefs.length) return snapshot;
  return client.save(intent.projectId,refs,snapshot.order.version,signal);
}
