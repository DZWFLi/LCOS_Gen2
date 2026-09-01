import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Project } from '@local-creative-os/contracts'
import type { LocalCoreErrorCode } from '../errors.js'
import { MetadataForeignKeyConstraintError, type SqliteMetadataRepository } from '../metadata-repository.js'

/** 路由模块共享的 HTTP 请求上下文。 */
export interface RouteHttpContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly controller: AbortController
  readonly metadata: SqliteMetadataRepository | undefined
}

/** server.ts 本地辅助函数集合，注入给路由模块，避免模块依赖巨型分发器。 */
export interface RouteHttpHelpers {
  readonly sendJson: (response: ServerResponse, statusCode: number, value: unknown) => void
  readonly failure: (code: LocalCoreErrorCode, message: string, retryable?: boolean) => {
    ok: false
    error: { code: string; message: string; retryable: boolean; origin: string }
  }
  readonly readJsonBody: (request: IncomingMessage, signal: AbortSignal) => Promise<unknown>
  readonly readRawBody: (request: IncomingMessage, signal: AbortSignal, maxBytes: number) => Promise<Buffer>
  readonly isRecord: (value: unknown) => value is Record<string, unknown>
  readonly isStringArray: (value: unknown) => value is string[]
  readonly withAbort: <Value>(operation: Promise<Value>, signal: AbortSignal) => Promise<Value>
  readonly statusForError: (code: string) => number
  readonly sendBinary: (response: ServerResponse, statusCode: number, bytes: Buffer, fileName: string, contentType?: string) => void
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** 浏览器只允许提交不透明 ID；路径类字段一律拒绝（与 server.ts 原语义一致）。 */
export const FORBIDDEN_BROWSER_PATH_FIELDS = new Set(['path', 'absolutePath', 'targetPath', 'observedPath', 'rootPath'])

/** 请求上下文必须有 metadata，否则按 server.ts 原语义返回 503 并返回 undefined。 */
export function routeRequireMetadata(ctx: {
  readonly metadata: SqliteMetadataRepository | undefined
  readonly response: ServerResponse
  readonly helpers: RouteHttpHelpers
}): SqliteMetadataRepository | undefined {
  if (ctx.metadata === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return undefined
  }
  return ctx.metadata
}

/** 项目必须存在，否则按 server.ts 原语义返回 404。 */
export function routeRequireProject(
  projectId: string,
  ctx: { readonly metadata: SqliteMetadataRepository; readonly response: ServerResponse; readonly helpers: RouteHttpHelpers },
): Project | undefined {
  const project = ctx.metadata.getProject(projectId)
  if (project === undefined) {
    ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Project not found.'))
    return undefined
  }
  return project
}

/** 元数据保存/变更错误的人类可读文案（含外键冲突专项）。 */
export function formatMetadataRouteError(error: unknown, fallback: string): string {
  if (error instanceof MetadataForeignKeyConstraintError) {
    return `Metadata references are inconsistent: ${error.message}`
  }
  return error instanceof Error ? error.message : fallback
}
