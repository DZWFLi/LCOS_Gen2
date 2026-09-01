// Production ProjectionBinding store — persists to Core SQLite (projection_bindings
// integration table) over HTTP. The DEFAULT store for the app path: bindings
// survive process restart (unlike the test-only MemoryBindingStore). Never stores
// geometry — spatial truth lives in Huabu; this is identity only.

import type { BindingRecord, BindingStore, EntityType, ProjectionBinding, SpatialKind } from '../spatial/projectionBinding.js';
import { ProjectionBindingRegistry, bindingKey } from '../spatial/projectionBinding.js';
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

  async load(): Promise<BindingRecord> {
    const envelope = await coreEnvelope<ProjectionBinding[]>(this.http, 'GET', this.path());
    const record: BindingRecord = {};
    for (const item of envelope.value) {
      const binding: ProjectionBinding = {
        projectId: String(item.projectId),
        canvasId: String(item.canvasId),
        spatialKind: String(item.spatialKind) as SpatialKind,
        spatialId: String(item.spatialId),
        entityType: String(item.entityType) as EntityType,
        entityId: String(item.entityId),
      };
      record[bindingKey(binding)] = binding;
    }
    return record;
  }

  async save(record: BindingRecord): Promise<void> {
    const current = await this.load();
    // Upsert new or changed bindings.
    for (const binding of Object.values(record)) {
      const existing = current[bindingKey(binding)];
      if (existing === undefined || existing.spatialId !== binding.spatialId) {
        await coreEnvelope<ProjectionBinding>(this.http, 'PUT', this.path(), { body: binding });
      }
    }
    // Delete bindings that were removed from the record (unbind).
    for (const binding of Object.values(current)) {
      if (record[bindingKey(binding)] === undefined) {
        await coreEnvelope<null>(this.http, 'DELETE', this.path(), {
          body: { canvasId: binding.canvasId, spatialKind: binding.spatialKind, entityType: binding.entityType, entityId: binding.entityId },
        });
      }
    }
  }
}

/** Production default registry: bindings persist in Core SQLite (no geometry). */
export function createProjectionBindingRegistry(http: HttpClient, projectId: string): ProjectionBindingRegistry {
  return new ProjectionBindingRegistry(new SqliteBindingStore(http, projectId));
}
