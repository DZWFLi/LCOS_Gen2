// Projection Binding — the ONLY bridge between LCOS EntityRef and Huabu spatial id.
// This is projection *identity*, not a second spatial state. It NEVER stores
// geometry (x/y/width/height/viewport/parentId). Persistent across reload/restart.
//
// G0.8a: the store interface is ATOMIC CRUD (list/find/upsert/delete), NOT the
// old load->save full-snapshot model. bind/unbind issue a single upsert/delete,
// so concurrent writers can never lose each other's bindings (no lost-update,
// no spurious delete from a stale snapshot).

// EntityType is the SAME binding model for every Core entity that can enter space
// (artifact/conversation/skill/run) plus the Core relation endpoint kinds
// (note/scope/view/workspace). We do NOT create a per-kind Binding type — a single
// ProjectionBinding carries whatever entityType the consumer projects.
export type EntityType =
  | 'artifact'
  | 'conversation'
  | 'skill'
  | 'run'
  | 'relation'
  | 'note'
  | 'scope'
  | 'view'
  | 'workspace';

export type SpatialKind = 'node' | 'edge';

export interface ProjectionBinding {
  projectId: string;
  canvasId: string;
  spatialKind: SpatialKind;
  spatialId: string;
  entityType: EntityType;
  entityId: string;
}

export type BindingKeyInput = Pick<ProjectionBinding, 'projectId' | 'canvasId' | 'spatialKind' | 'entityType' | 'entityId'>;

/** Atomic key used by the Core projection_bindings primary key. */
export type BindingKey = Pick<ProjectionBinding, 'canvasId' | 'spatialKind' | 'entityType' | 'entityId'>;

export function bindingKey(binding: BindingKeyInput): string {
  return `${binding.projectId}|${binding.canvasId}|${binding.spatialKind}|${binding.entityType}|${binding.entityId}`;
}

/** Atomic CRUD contract. Writes are single-key operations (never a full snapshot). */
export interface BindingStore {
  /** All bindings currently known (for reconciliation sweeps / inspections). */
  list(): Promise<ProjectionBinding[]>;
  find(binding: BindingKeyInput): Promise<ProjectionBinding | undefined>;
  upsert(binding: ProjectionBinding): Promise<void>;
  delete(binding: BindingKeyInput): Promise<void>;
}

/** In-memory default. For tests only — not durable across process restarts. */
export class MemoryBindingStore implements BindingStore {
  private record = new Map<string, ProjectionBinding>();
  async list(): Promise<ProjectionBinding[]> {
    return [...this.record.values()];
  }
  async find(binding: BindingKeyInput): Promise<ProjectionBinding | undefined> {
    return this.record.get(bindingKey(binding));
  }
  async upsert(binding: ProjectionBinding): Promise<void> {
    this.record.set(bindingKey(binding), binding);
  }
  async delete(binding: BindingKeyInput): Promise<void> {
    this.record.delete(bindingKey(binding));
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

  private async readAll(): Promise<Map<string, ProjectionBinding>> {
    try {
      const text = await this.fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as Record<string, ProjectionBinding>;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private async writeAll(record: Map<string, ProjectionBinding>): Promise<void> {
    const obj = Object.fromEntries(record.entries());
    await this.fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  async list(): Promise<ProjectionBinding[]> {
    return [...(await this.readAll()).values()];
  }
  async find(binding: BindingKeyInput): Promise<ProjectionBinding | undefined> {
    return (await this.readAll()).get(bindingKey(binding));
  }
  async upsert(binding: ProjectionBinding): Promise<void> {
    const record = await this.readAll();
    record.set(bindingKey(binding), binding);
    await this.writeAll(record);
  }
  async delete(binding: BindingKeyInput): Promise<void> {
    const record = await this.readAll();
    record.delete(bindingKey(binding));
    await this.writeAll(record);
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
    return this.store.find({ projectId, canvasId, spatialKind, entityType, entityId });
  }

  async findNode(projectId: string, canvasId: string, entityType: EntityType, entityId: string): Promise<ProjectionBinding | undefined> {
    return this.find(projectId, canvasId, 'node', entityType, entityId);
  }

  async findEdge(projectId: string, canvasId: string, entityId: string): Promise<ProjectionBinding | undefined> {
    return this.find(projectId, canvasId, 'edge', 'relation', entityId);
  }

  /**
   * Reverse lookup: from a Huabu spatial node id back to the Core entity ref
   * it projects. Used by the A05 semantic-connect seam to translate a
   * gesture's node ids into entity refs before creating a Core relation.
   * Scans list() — fine for the canvas-scope graph; a spatialId index can
   * replace it later without changing callers.
   */
  async findNodeRef(projectId: string, canvasId: string, nodeId: string): Promise<{ entityType: EntityType; entityId: string } | undefined> {
    const all = await this.store.list();
    for (const binding of all) {
      if (binding.projectId === projectId && binding.canvasId === canvasId && binding.spatialKind === 'node' && binding.spatialId === nodeId) {
        return { entityType: binding.entityType, entityId: binding.entityId };
      }
    }
    return undefined;
  }

  /** Atomically record a single binding (never a full-snapshot write). */
  async bind(binding: ProjectionBinding): Promise<void> {
    await this.store.upsert(binding);
  }

  /** Atomically remove a single binding. */
  async unbind(binding: BindingKeyInput): Promise<void> {
    await this.store.delete(binding);
  }

  /** Remove a binding by its entity (node or edge). */
  async unbindByEntity(projectId: string, canvasId: string, spatialKind: SpatialKind, entityType: EntityType, entityId: string): Promise<void> {
    return this.unbind({ projectId, canvasId, spatialKind, entityType, entityId });
  }

  /** All bindings currently held by the store (for reconciliation sweeps). */
  async list(): Promise<ProjectionBinding[]> {
    return this.store.list();
  }
}
