// Projection Binding — the ONLY bridge between LCOS EntityRef and Huabu node.
// This is projection *identity*, not a second spatial state. It never stores
// x/y/viewport/geometry. Resolution prefers Huabu node metadata, falling back
// to a minimal Core binding store only when Huabu can't index the ref.

export type EntityType = 'artifact' | 'conversation' | 'skill' | 'run';

export interface ProjectionBinding {
  projectId: string;
  canvasId: string;
  nodeId: string;
  entityType: EntityType;
  entityId: string;
}

export type BindingRecord = Record<string, ProjectionBinding>;

export interface BindingStore {
  load(): Promise<BindingRecord>;
  save(record: BindingRecord): Promise<void>;
}

/** In-memory default for G0. Production should persist to Huabu node metadata or Core binding store. */
export class MemoryBindingStore implements BindingStore {
  private record: BindingRecord = {};
  async load(): Promise<BindingRecord> {
    return { ...this.record };
  }
  async save(record: BindingRecord): Promise<void> {
    this.record = { ...record };
  }
}

const NODE_META_KEY = 'lcos';

export function entityKey(entityType: EntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function bindingToNodeMeta(binding: ProjectionBinding): Record<string, unknown> {
  return {
    [NODE_META_KEY]: {
      entityType: binding.entityType,
      entityId: binding.entityId,
      projectId: binding.projectId,
      canvasId: binding.canvasId,
    },
  };
}

export function nodeMetaToBinding(canvasId: string, nodeId: string, meta: unknown): ProjectionBinding | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = (meta as Record<string, unknown>)[NODE_META_KEY];
  if (!m || typeof m !== 'object') return undefined;
  const v = m as Record<string, string>;
  if (!v.entityType || !v.entityId) return undefined;
  return {
    projectId: v.projectId ?? '',
    canvasId: v.canvasId ?? canvasId,
    nodeId,
    entityType: v.entityType as EntityType,
    entityId: v.entityId,
  };
}

export class ProjectionBindingRegistry {
  constructor(private readonly store: BindingStore = new MemoryBindingStore()) {}

  async resolve(entityType: EntityType, entityId: string): Promise<ProjectionBinding | undefined> {
    const record = await this.store.load();
    return record[entityKey(entityType, entityId)];
  }

  async bind(binding: ProjectionBinding): Promise<void> {
    const record = await this.store.load();
    record[entityKey(binding.entityType, binding.entityId)] = binding;
    await this.store.save(record);
  }

  async unbind(entityType: EntityType, entityId: string): Promise<void> {
    const record = await this.store.load();
    delete record[entityKey(entityType, entityId)];
    await this.store.save(record);
  }
}
