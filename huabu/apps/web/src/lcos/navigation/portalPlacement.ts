import type { RailwayDestinationV1 } from '@local-creative-os/contracts';

interface PortalCarrier {
  readonly id: string;
  readonly type?: string;
  readonly data: Readonly<Record<string, unknown>>;
}
interface PortalBinding {
  readonly canvasId: string;
  readonly spatialId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly spatialKind: string;
}
export interface PortalPlacementPorts {
  readonly current: () => boolean;
  readonly nodes: () => readonly PortalCarrier[];
  readonly bindings: () => Promise<readonly PortalBinding[]>;
  readonly readTarget: (workspaceId: string, signal?: AbortSignal) => Promise<RailwayDestinationV1>;
  readonly create: (canvasId: string, label: string) => string;
  readonly save: () => Promise<boolean>;
  readonly claim: (workspaceId: string, nodeId: string, targetCanvasId: string) => Promise<PortalBinding>;
}

/** Explicit placement into the current scene. Native add/save first, conditional
 * Core identity claim second. An uncertain write is recovered on the same carrier;
 * it never licenses a duplicate node, a new worksite, or deletion of user content. */
export async function placeExistingWorkspacePortal(projectId: string, sourceCanvasId: string,
  requested: RailwayDestinationV1, ports: PortalPlacementPorts, signal?: AbortSignal,
): Promise<{nodeId: string; status: 'placed' | 'existing'}> {
  if (requested.ref.kind !== 'worksite' || requested.ref.projectId !== projectId || !requested.canvasId)
    throw new Error('请选择一个已存在的工作现场。');
  const workspaceId = requested.ref.worksiteId;
  const target = await ports.readTarget(workspaceId, signal);
  const active = () => ports.current() && !signal?.aborted;
  if (!active()) throw new Error('来源已离开，未放置入口。');
  if (!target.available || target.ref.kind !== 'worksite' || target.ref.projectId !== projectId
    || target.ref.worksiteId !== workspaceId || target.canvasId !== requested.canvasId || target.canvasId === sourceCanvasId)
    throw new Error(target.reason ?? '目标已变化，请重新选择；未放置入口。');
  const bindings = await ports.bindings();
  if (!active()) throw new Error('来源已离开，未放置入口。');
  const existing = bindings.find((b) => b.canvasId === sourceCanvasId && b.spatialKind === 'node'
    && b.entityType === 'workspace' && b.entityId === workspaceId);
  const carrierMatches = (node: PortalCarrier | undefined) => !!node && ['spacePreview','canvasRef'].includes(node.type ?? '')
    && node.data.targetCanvasId === target.canvasId;
  if (existing) {
    if (!carrierMatches(ports.nodes().find((n) => n.id === existing.spatialId)))
      throw new Error('原入口已移动到别的目标或投影尚未恢复，不会覆盖原绑定。');
    return {nodeId:existing.spatialId,status:'existing'};
  }
  const occupied = new Set(bindings.filter((b) => b.canvasId === sourceCanvasId && b.spatialKind === 'node').map((b) => b.spatialId));
  const candidates = ports.nodes().filter((n) => carrierMatches(n) && !occupied.has(n.id));
  if (candidates.length > 1) throw new Error('当前画布有多个未绑定的同目标入口，请先保留一个再重试。');
  if (candidates[0]?.data.locked === true) throw new Error('已有入口已锁定，未修改。');
  const nodeId = candidates[0]?.id ?? ports.create(target.canvasId!, target.label);
  const untouched = () => active() && carrierMatches(ports.nodes().find((n) => n.id === nodeId))
    && ports.nodes().find((n) => n.id === nodeId)?.data.locked !== true;
  if (!untouched()) throw new Error('入口尚未落位或已被修改，未确认绑定。');
  if (!(await ports.save())) throw new Error('入口已留在当前画布，但保存尚未确认；请再次使用放置入口核对同一节点。');
  if (!untouched()) throw new Error('入口已保存，但来源或节点已变化，未确认绑定。');
  let binding: PortalBinding;
  try { binding = await ports.claim(workspaceId,nodeId,target.canvasId!); }
  catch (error) {
    // The claim reply may have been lost. Only read, never create another carrier.
    const readback = await ports.bindings().catch(() => []);
    const confirmed = readback.find((b) => b.canvasId === sourceCanvasId && b.spatialKind === 'node'
      && b.entityType === 'workspace' && b.entityId === workspaceId && b.spatialId === nodeId);
    if (!confirmed) throw error;
    binding = confirmed;
  }
  if (binding.canvasId !== sourceCanvasId || binding.spatialId !== nodeId || binding.entityType !== 'workspace'
    || binding.entityId !== workspaceId || binding.spatialKind !== 'node') throw new Error('入口绑定回执不匹配，请先核对同一节点。');
  return {nodeId,status:'placed'};
}
