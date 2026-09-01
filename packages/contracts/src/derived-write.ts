/**
 * HU-5 §10：DerivedWriteGuard —— 异步 writer（preview / semantic /
 * embedding / capture enrichment / watcher postprocess）提交派生结果前的
 * 竞态守卫契约。只是机制，不承载业务语义。
 */
export type DerivedWriteStatusV0 = 'applied' | 'skipped_deleted' | 'skipped_stale'

export interface DerivedWriteGuardV0 {
  readonly entityType: 'artifact' | 'resource' | 'conversation'
  readonly entityId: string
  readonly projectId?: string
  readonly expectedRevisionId?: string
  readonly expectedContentHash?: string
}
