// Production ProjectionBinding store — persists to Core SQLite (projection_bindings
// integration table) over HTTP. The DEFAULT store for the app path: bindings
// survive process restart (unlike the test-only MemoryBindingStore). Never stores
// geometry — spatial truth lives in Huabu; this is identity only.
//
// G0.8a: ATOMIC CRUD. A single upsert -> one PUT; a single delete -> one DELETE.
// Never loads the whole snapshot and rewrites it, so two writers (e.g. a UI
// gesture + a reconciliation sweep) can't clobber each other's bindings.
// Read ops (list/find) are safe; only writes are concurrency-sensitive and they
// are now single-row.

import type { BindingKeyInput, BindingStore, EntityType, ProjectionBinding, SpatialKind } from '../spatial/projectionBinding.js';
import { ProjectionBindingRegistry } from '../spatial/projectionBinding.js';
import { HttpClient } from './client.js';
import { coreEnvelope } from './coreTypes.js';

export class SqliteBindingStore implements BindingStore {
  constructor(
    private readonly http: HttpClient,
    private readonly projectId: string,
  ) {}

  private path(): string {
    return `/projects/${encodeURIComponent(this.projectId)}/spatial/bindings`;
  }

  async list(): Promise<ProjectionBinding[]> {
    const envelope = await coreEnvelope<ProjectionBinding[]>(this.http, 'GET', this.path());
    return envelope.value.map((item) => this.toBinding(item));
  }

  async find(binding: BindingKeyInput): Promise<ProjectionBinding | undefined> {
    // Read-only scan; the Core GET returns all rows for the project. Safe under
    // concurrency (no write), not a snapshot that gets written back.
    const bindings = await this.list();
    return bindings.find((b) => this.matches(b, binding));
  }

  async upsert(binding: ProjectionBinding): Promise<void> {
    await coreEnvelope<ProjectionBinding>(this.http, 'PUT', this.path(), { body: binding });
  }

  async delete(binding: BindingKeyInput): Promise<void> {
    await coreEnvelope<null>(this.http, 'DELETE', this.path(), {
      body: { canvasId: binding.canvasId, spatialKind: binding.spatialKind, entityType: binding.entityType, entityId: binding.entityId },
    });
  }

  private matches(binding: ProjectionBinding, key: Pick<ProjectionBinding, 'canvasId' | 'spatialKind' | 'entityType' | 'entityId'>): boolean {
    return binding.canvasId === key.canvasId
      && binding.spatialKind === key.spatialKind
      && binding.entityType === key.entityType
      && binding.entityId === key.entityId;
  }

  private toBinding(item: ProjectionBinding): ProjectionBinding {
    return {
      projectId: String(item.projectId),
      canvasId: String(item.canvasId),
      spatialKind: String(item.spatialKind) as SpatialKind,
      spatialId: String(item.spatialId),
      entityType: String(item.entityType) as EntityType,
      entityId: String(item.entityId),
    };
  }
}

/** Production default registry: bindings persist in Core SQLite (no geometry). */
export function createProjectionBindingRegistry(http: HttpClient, projectId: string): ProjectionBindingRegistry {
  return new ProjectionBindingRegistry(new SqliteBindingStore(http, projectId));
}
