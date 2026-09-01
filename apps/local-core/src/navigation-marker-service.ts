import type { Note, Scope } from '@local-creative-os/domain'
import type {
  NavigationResolutionV0,
  NavigationSurfaceKindV0,
  SpatialMarkerTargetRefV0,
  StableSurfaceRefV0,
} from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * F6A2 后端小刀（20260829）：Spatial Marker 的导航目标解析器。
 *
 * 只做 targetRef → { surfaceRef, surfaceKind, anchorRef?, worldPosition? } 的
 * canonical 解析，不做任何投影/聚类/label（前端 Presentation）。
 *
 * 纪律（后端 followup §Invariants）：
 * - 跨 Project fail-close（unresolved: cross-project）；
 * - target 删除/不可用 → unresolved: target-missing，绝不按 title/provider/time
 *   模糊重绑到「最像的对象」；
 * - worldPosition 每次实时读 canonical truth（view.position / workspace frame），
 *   Core 不复制坐标——目标移动后 resolve 自动跟上新位置；
 * - Surface ref 用稳定词汇（main / scope: / workspace: / conversation: / assembly），
 *   不是 GUI route string。
 */
export class NavigationMarkerService {
  readonly #metadata: SqliteMetadataRepository

  constructor(metadata: SqliteMetadataRepository) {
    this.#metadata = metadata
  }

  /**
   * 解析一个导航目标。projectId 是发起解析的项目上下文；
   * targetRef.projectId 与之不符 → cross-project fail-close。
   */
  resolveNavigationTarget(projectId: string, targetRef: SpatialMarkerTargetRefV0): NavigationResolutionV0 {
    if (String(targetRef.projectId) !== String(projectId)) {
      return { status: 'unresolved', reason: 'cross-project' }
    }
    if (targetRef.id.length === 0) {
      return { status: 'unresolved', reason: targetRef.kind === 'surface' ? 'unknown-surface' : 'target-missing' }
    }
    if (targetRef.kind === 'view') return this.#resolveView(projectId, targetRef.id)
    if (targetRef.kind === 'entity') return this.#resolveEntity(projectId, targetRef.id)
    if (targetRef.kind === 'surface') return this.#resolveSurface(projectId, targetRef.id)
    return { status: 'unresolved', reason: 'unknown-target-kind' }
  }

  // ---------- kind: view（ArtifactView → 所在 scope 的 surface + 实时坐标） ----------

  #resolveView(projectId: string, viewId: string): NavigationResolutionV0 {
    const view = this.#metadata.getArtifactView(viewId)
    if (view === undefined) return { status: 'unresolved', reason: 'target-missing' }
    const scope = this.#findScope(projectId, String(view.scopeId))
    if (scope === undefined) return { status: 'unresolved', reason: 'target-missing' }
    const surface = this.#surfaceForScope(scope)
    if (surface === undefined) return { status: 'unresolved', reason: 'unknown-surface' }
    return {
      status: 'resolved',
      target: {
        projectId,
        surfaceRef: surface.surfaceRef,
        surfaceKind: surface.surfaceKind,
        anchorRef: String(view.id),
        worldPosition: { x: view.position.x, y: view.position.y },
      },
    }
  }

  // ---------- kind: entity（Note / Conversation / Scope / Workspace） ----------

  #resolveEntity(projectId: string, entityId: string): NavigationResolutionV0 {
    // Note：按 anchor 归属 surface；无 canonical 坐标（worldPosition 留空，诚实）。
    const note = this.#metadata.getNote(entityId)
    if (note !== undefined) return this.#resolveNote(projectId, note)

    // Conversation：Subcanvas 本身就是导航目的地。
    const conversation = this.#metadata.getConnectedConversation(projectId, entityId)
    if (conversation !== undefined) {
      return {
        status: 'resolved',
        target: {
          projectId,
          surfaceRef: `conversation:${entityId}` as StableSurfaceRefV0,
          surfaceKind: 'conversation',
          anchorRef: entityId,
        },
      }
    }

    // Scope：自身即 surface（root → main）。
    const scope = this.#findScope(projectId, entityId)
    if (scope !== undefined) {
      const surface = this.#surfaceForScope(scope)
      if (surface === undefined) return { status: 'unresolved', reason: 'unknown-surface' }
      return {
        status: 'resolved',
        target: { projectId, surfaceRef: surface.surfaceRef, surfaceKind: surface.surfaceKind, anchorRef: entityId },
      }
    }

    // Workspace（Scene）：frame 存在时给出中心点（实时读取，不复制）。
    const workspace = this.#metadata.getWorkspace(entityId)
    if (workspace !== undefined && String(workspace.projectId) === String(projectId)) {
      const frame = workspace.frameBounds
      return {
        status: 'resolved',
        target: {
          projectId,
          surfaceRef: `workspace:${entityId}` as StableSurfaceRefV0,
          surfaceKind: 'scene',
          anchorRef: entityId,
          ...(frame === undefined ? {} : { worldPosition: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 } }),
        },
      }
    }

    return { status: 'unresolved', reason: 'target-missing' }
  }

  #resolveNote(projectId: string, note: Note): NavigationResolutionV0 {
    const anchor = note.anchor
    // scope 锚：note 随锚 scope 的 surface（锚 scope 已删则回落 main，项目世界根）。
    if (anchor.type === 'scope') {
      const scope = this.#findScope(projectId, String(anchor.scopeId))
      if (scope !== undefined) {
        const surface = this.#surfaceForScope(scope)
        if (surface !== undefined) {
          return {
            status: 'resolved',
            target: { projectId, surfaceRef: surface.surfaceRef, surfaceKind: surface.surfaceKind, anchorRef: String(note.id) },
          }
        }
      }
    }
    // project 锚 / artifact·view·page 锚（无唯一 surface 主张）：main（项目世界根）。
    return {
      status: 'resolved',
      target: { projectId, surfaceRef: 'main', surfaceKind: 'main', anchorRef: String(note.id) },
    }
  }

  // ---------- kind: surface（稳定 surface ref 词汇直解） ----------

  #resolveSurface(projectId: string, surfaceId: string): NavigationResolutionV0 {
    if (surfaceId === 'main') {
      return { status: 'resolved', target: { projectId, surfaceRef: 'main', surfaceKind: 'main' } }
    }
    if (surfaceId === 'assembly') {
      return { status: 'resolved', target: { projectId, surfaceRef: 'assembly', surfaceKind: 'assembly' } }
    }
    if (surfaceId.startsWith('scope:')) {
      const scope = this.#findScope(projectId, surfaceId.slice('scope:'.length))
      if (scope === undefined) return { status: 'unresolved', reason: 'target-missing' }
      const surface = this.#surfaceForScope(scope)
      if (surface === undefined) return { status: 'unresolved', reason: 'unknown-surface' }
      return { status: 'resolved', target: { projectId, surfaceRef: surface.surfaceRef, surfaceKind: surface.surfaceKind } }
    }
    if (surfaceId.startsWith('workspace:')) {
      const workspace = this.#metadata.getWorkspace(surfaceId.slice('workspace:'.length))
      if (workspace === undefined || String(workspace.projectId) !== String(projectId)) {
        return { status: 'unresolved', reason: 'target-missing' }
      }
      return { status: 'resolved', target: { projectId, surfaceRef: `workspace:${String(workspace.id)}` as StableSurfaceRefV0, surfaceKind: 'scene' } }
    }
    if (surfaceId.startsWith('conversation:')) {
      const conversationId = surfaceId.slice('conversation:'.length)
      const conversation = this.#metadata.getConnectedConversation(projectId, conversationId)
      if (conversation === undefined) return { status: 'unresolved', reason: 'target-missing' }
      return { status: 'resolved', target: { projectId, surfaceRef: `conversation:${conversationId}` as StableSurfaceRefV0, surfaceKind: 'conversation' } }
    }
    return { status: 'unresolved', reason: 'unknown-surface' }
  }

  // ---------- helpers ----------

  #findScope(projectId: string, scopeId: string): Scope | undefined {
    return this.#metadata.getScopes(projectId).find((scope) => String(scope.id) === scopeId)
  }

  /**
   * ScopeKind → 可导航 surface。root → main；context/workflow/collection 直映；
   * delivery / temporary-workbench 在 v0.15 无对应可导航 surface——诚实
   * unknown-surface，不硬凑映射。
   */
  #surfaceForScope(scope: Scope): { readonly surfaceRef: StableSurfaceRefV0; readonly surfaceKind: NavigationSurfaceKindV0 } | undefined {
    if (scope.kind === 'root') return { surfaceRef: 'main', surfaceKind: 'main' }
    if (scope.kind === 'context') return { surfaceRef: `scope:${String(scope.id)}` as StableSurfaceRefV0, surfaceKind: 'context' }
    if (scope.kind === 'workflow') return { surfaceRef: `scope:${String(scope.id)}` as StableSurfaceRefV0, surfaceKind: 'workflow' }
    if (scope.kind === 'collection') return { surfaceRef: `scope:${String(scope.id)}` as StableSurfaceRefV0, surfaceKind: 'collection' }
    return undefined
  }
}
