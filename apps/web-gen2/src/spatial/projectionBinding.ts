// Projection Binding — the ONLY bridge between LCOS EntityRef and Huabu spatial id.
// This is projection *identity*, not a second spatial state. It NEVER stores
// geometry (x/y/width/height/viewport/parentId). Persistent across reload/restart.

export type EntityType = 'artifact' | 'conversation' | 'skill' | 'run' | 'relation';

export type SpatialKind = 'node' | 'edge';

export interface ProjectionBinding {
  projectId: string;
  canvasId: string;
  spatialKind: SpatialKind;
  spatialId: string;
  entityType: EntityType;
  entityId: string;
}

export type BindingRecord = Record<string, ProjectionBinding>;

export function bindingKey(binding: Pick<ProjectionBinding, 'projectId' | 'canvasId' | 'spatialKind' | 'entityType' | 'entityId'>): string {
  return `${binding.projectId}|${binding.canvasId}|${binding.spatialKind}|${binding.entityType}|${binding.entityId}`;
}

export interface BindingStore {
  load(): Promise<BindingRecord>;
  save(record: BindingRecord): Promise<void>;
}

/** In-memory default. For tests only — not durable across process restarts. */
export class MemoryBindingStore implements BindingStore {
  private record: BindingRecord = {};
  async load(): Promise<BindingRecord> {
    return { ...this.record };
  }
  async save(record: BindingRecord): Promise<void> {
    this.record = { ...record };
  }
}

/** File-system adapter so the web package never imports node:fs directly. */
export interface FileSystemLike {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
}

/** Node-only durable store backed by a JSON file (no geometry). fs is injected. */
export class FileBindingStore implements BindingStore {
  constructor(
    private readonly filePath: string,
    private readonly fs: FileSystemLike,
  ) {}
  async load(): Promise<BindingRecord> {
    try {
      const text = await this.fs.readFile(this.filePath, 'utf8');
      return JSON.parse(text) as BindingRecord;
    } catch {
      return {};
    }
  }
  async save(record: BindingRecord): Promise<void> {
    await this.fs.writeFile(this.filePath, JSON.stringify(record, null, 2), 'utf8');
  }
}

export class ProjectionBindingRegistry {
  constructor(private readonly store: BindingStore = new MemoryBindingStore()) {}

  async find(
    projectId: string,
    canvasId: string,
    spatialKind: SpatialKind,
    entityType: EntityType,
    entityId: string,
  ): Promise<ProjectionBinding | undefined> {
    const record = await this.store.load();
    return record[bindingKey({ projectId, canvasId, spatialKind, entityType, entityId })];
  }

  async findNode(projectId: string, canvasId: string, entityType: EntityType, entityId: string): Promise<ProjectionBinding | undefined> {
    return this.find(projectId, canvasId, 'node', entityType, entityId);
  }

  async findEdge(projectId: string, canvasId: string, entityId: string): Promise<ProjectionBinding | undefined> {
    return this.find(projectId, canvasId, 'edge', 'relation', entityId);
  }

  async bind(binding: ProjectionBinding): Promise<void> {
    const record = await this.store.load();
    record[bindingKey(binding)] = binding;
    await this.store.save(record);
  }

  async unbind(binding: Pick<ProjectionBinding, 'projectId' | 'canvasId' | 'spatialKind' | 'entityType' | 'entityId'>): Promise<void> {
    const record = await this.store.load();
    delete record[bindingKey(binding)];
    await this.store.save(record);
  }

  /** Remove a binding by its entity (node or edge). */
  async unbindByEntity(projectId: string, canvasId: string, spatialKind: SpatialKind, entityType: EntityType, entityId: string): Promise<void> {
    return this.unbind({ projectId, canvasId, spatialKind, entityType, entityId });
  }
}
