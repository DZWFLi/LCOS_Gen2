import type { ProjectExecutionProjection, ResultSlotV0, RunCanvasProjection } from '@local-creative-os/contracts';
import type { CoreRunClient } from '../backend/runs.js';
import type { ProjectionBinding, ProjectionBindingRegistry } from './projectionBinding.js';
import type { ProjectToSpaceProjection } from './projectToSpaceProjection.js';

export interface ExecutionWorksite {
  readonly id: string;
  readonly scopeId?: string;
  readonly preferredSurface?: string;
}

/** Missing worksite mapping is not permission to put every Run on this canvas.
 * Legacy unscoped runs/slots belong only to an explicit Main root. */
export function executionBelongsHere(item: Pick<RunCanvasProjection, 'workspaceId'> & { scopeId?: string }, workspace?: ExecutionWorksite): boolean {
  if (!workspace) return false;
  if (item.workspaceId !== undefined) return item.workspaceId === String(workspace.id);
  return workspace.preferredSurface === 'main'
    && (item.scopeId === undefined || item.scopeId === String(workspace.scopeId));
}

export function validateExecutionProjection(value: ProjectExecutionProjection, projectId: string): void {
  if (value?.projectId !== projectId || !Array.isArray(value.runs) || !Array.isArray(value.resultSlots)) {
    throw new Error('Execution projection does not belong to this project.');
  }
  const runIds = new Set<string>();
  for (const run of value.runs) {
    if (run.projectId !== projectId || !run.id || runIds.has(run.id) || !Array.isArray(run.pendingArtifactIds)) throw new Error('Invalid Run identity set.');
    runIds.add(run.id);
  }
  const slotIds = new Set<string>();
  for (const slot of value.resultSlots) {
    if (slot.projectId !== projectId || !slot.id || slotIds.has(slot.id)
      || !Number.isFinite(slot.position?.x) || !Number.isFinite(slot.position?.y)
      || (slot.runId !== undefined && !runIds.has(slot.runId))) throw new Error('Invalid result-slot identity set.');
    slotIds.add(slot.id);
  }
}

export interface ExecutionReconciliation {
  readonly snapshot: ProjectExecutionProjection;
  readonly bindings: readonly ProjectionBinding[];
  readonly runIds: ReadonlySet<string>;
  readonly slotIds: ReadonlySet<string>;
  readonly blockedArtifactIds: ReadonlySet<string>;
  readonly failures: number;
  readonly runsProjected: number;
  readonly slotsProjected: number;
  readonly promoted: number;
}

/** All writes go through the same projector/binding owner as normal materials.
 * Slot->Artifact promotion only replaces identity after the Core accept receipt;
 * the native node id, parent and user geometry are never replaced. */
export async function reconcileExecutionProjection(input: {
  projectId: string; canvasId: string; snapshot: ProjectExecutionProjection;
  workspace?: ExecutionWorksite; activeArtifactIds: ReadonlySet<string>;
  runs: CoreRunClient; nodeProjector: ProjectToSpaceProjection; bindings: ProjectionBindingRegistry;
}): Promise<ExecutionReconciliation> {
  const { projectId, canvasId, snapshot, workspace, runs, nodeProjector, bindings } = input;
  validateExecutionProjection(snapshot, projectId);
  const eligibleRuns = snapshot.runs.filter((run) => executionBelongsHere(run, workspace));
  const eligibleSlots = snapshot.resultSlots.filter((slot) => executionBelongsHere(slot, workspace)
    && (slot.status !== 'materialized' || Boolean(slot.artifactId && input.activeArtifactIds.has(slot.artifactId))));
  const report = await nodeProjector.projectBatchWithReport(eligibleRuns.map((run) => ({
    projectId, entityType: 'run' as const, entityId: run.id, kind: 'text' as const, title: run.title,
  })));
  const projected: ProjectionBinding[] = [...report.bindings];
  let failures = report.failures.length, slotsProjected = 0, promoted = 0;
  // A pending output reserved for a slot must not first appear elsewhere as an
  // Artifact and then be copied/deleted when accepted. Existing bound sources
  // remain intact; only the ordinary projection of these pending ids is skipped.
  const blockedArtifactIds = new Set(eligibleSlots.filter((slot) => slot.status !== 'materialized')
    .flatMap((slot) => snapshot.runs.find((run) => run.id === slot.runId)?.pendingArtifactIds ?? []));
  for (const slot of eligibleSlots) {
    try {
      // A previous pass may already have promoted this very slot. Do not recreate it.
      const existingSlot = await bindings.findNode(projectId, canvasId, 'result-slot', slot.id);
      const existingArtifact = slot.status === 'materialized' && slot.artifactId
        ? await bindings.findNode(projectId, canvasId, 'artifact', slot.artifactId) : undefined;
      if (existingArtifact && !existingSlot) continue;
      const binding = await nodeProjector.projectEntity({
        projectId, entityType: 'result-slot', entityId: slot.id, kind: 'file',
        title: snapshot.runs.find((run) => run.id === slot.runId)?.title ?? '结果位',
        position: slot.position,
        size: validSlotSize(slot),
      });
      slotsProjected += 1;
      if (slot.status === 'materialized' && slot.artifactId) {
        const receipt = await runs.materializeResultSlotProjection(projectId, slot.id, canvasId, binding.spatialId);
        if (!['promoted', 'already-promoted', 'existing-artifact'].includes(receipt.status)
          || receipt.binding.projectId !== projectId || receipt.binding.canvasId !== canvasId
          || receipt.binding.entityType !== 'artifact' || receipt.binding.entityId !== slot.artifactId
          || (receipt.status !== 'existing-artifact' && receipt.binding.spatialId !== binding.spatialId)) {
          throw new Error('Materialization receipt identity mismatch.');
        }
        projected.push(receipt.binding);
        if (receipt.status === 'existing-artifact') projected.push(binding);
        else promoted += 1;
      } else projected.push(binding);
    } catch (error) {
      failures += 1;
      // Do not create an output elsewhere while its original slot is awaiting repair.
      if (slot.status === 'materialized' && slot.artifactId) blockedArtifactIds.add(slot.artifactId);
      console.warn('[lcos] Result slot projection remains pending; canonical accept is preserved.', { slotId: slot.id, error });
    }
  }
  return { snapshot, bindings: projected, failures, runsProjected: report.bindings.length, slotsProjected, promoted,
    runIds: new Set(eligibleRuns.map((run) => run.id)), slotIds: new Set(eligibleSlots.map((slot) => slot.id)), blockedArtifactIds };
}

function validSlotSize(slot: ResultSlotV0): { width: number; height: number } {
  const size = slot.size;
  return size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? size : { width: 248, height: 180 };
}
