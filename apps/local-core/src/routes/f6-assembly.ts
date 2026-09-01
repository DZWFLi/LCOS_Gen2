/**
 * F6 后端同步施工单路由（20260828）：
 * - P0-B2：GET /projects/{id}/warehouse（Material/Relation View 共用 read model）
 * - P0-D3：GET /projects/{id}/connected-conversations/{cid}/reach
 * - P0-D5：POST/GET /projects/{id}/result-slots、GET/DELETE /result-slots/{slotId}
 * - P0-D6：GET /runs/{runId}/recipe（聚合只读投影）
 */
import type {
  ConversationReachResultV0,
  ResultSlotV0,
  RunRecipeV0,
  WarehouseQueryV1,
  WarehouseSnapshotV1,
  WarehouseEntityKindV1,
  AssemblyApplyRequestV1,
  AssemblyApplyResultV1,
  ProjectSummaryV1,
  ProjectVisualProfileV0,
  UpsertProjectVisualProfileInputV0,
} from '@local-creative-os/contracts'
import { PROJECT_GLYPH_MARK_REPERTOIRE, PROJECT_TINT_TOKENS } from '@local-creative-os/contracts'
import type { ProjectId, RunId } from '@local-creative-os/domain'
import type { ConversationIdentityService } from '../conversation-identity-service.js'
import type { ResultSlotService } from '../result-slot-service.js'
import type { WarehouseService } from '../warehouse-service.js'
import type { AssemblyApplyService } from '../assembly-apply-service.js'
import type { ProjectSummaryService } from '../project-summary-service.js'
import type { SkillCatalogService } from '../skill-catalog-service.js'
import type { SkillPackageService } from '../skill-package-service.js'
import type { SkillProposalService } from '../skill-proposal-service.js'
import type { CompanionProjectionService } from '../companion-projection-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface F6AssemblyRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly warehouse: WarehouseService | undefined
  readonly resultSlots: ResultSlotService | undefined
  readonly conversationIdentity: ConversationIdentityService | undefined
  readonly assemblyApply: AssemblyApplyService | undefined
  readonly projectSummary: ProjectSummaryService | undefined
  readonly skillCatalog: SkillCatalogService | undefined
  readonly skillPackages: SkillPackageService | undefined
  readonly skillProposals: SkillProposalService | undefined
  readonly companionProjections: CompanionProjectionService | undefined
  readonly metadata: SqliteMetadataRepository
}

export async function handleF6AssemblyRoute(ctx: F6AssemblyRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, controller, metadata, warehouse, resultSlots, conversationIdentity, assemblyApply, projectSummary, skillCatalog, skillPackages, skillProposals, companionProjections } = ctx
  const { sendJson, failure, readJsonBody, isRecord } = ctx.helpers

  // ---------- P0-B4：Semantic Drop 统一 apply ----------
  const applyMatch = /^\/projects\/([^/]+)\/assembly\/apply$/.exec(pathname)
  if (method === 'POST' && applyMatch !== null) {
    if (assemblyApply === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Assembly apply service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(applyMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Assembly apply body must be valid JSON.'))
      return true
    }
    if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.sourceRefs) || !isRecord(input.targetRef)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Assembly apply requires schemaVersion 1, sourceRefs[], targetRef.'))
      return true
    }
    try {
      const value: AssemblyApplyResultV1 = await assemblyApply.apply(input as unknown as AssemblyApplyRequestV1)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Assembly apply failed.'))
    }
    return true
  }
  // ---------- P0-B2：Warehouse read model ----------
  const warehouseMatch = /^\/projects\/([^/]+)\/warehouse$/.exec(pathname)
  if (method === 'GET' && warehouseMatch !== null) {
    if (warehouse === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Warehouse service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(warehouseMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const kindsRaw = url.searchParams.get('kinds')
    const kinds = kindsRaw === null
      ? undefined
      : kindsRaw.split(',').map((value) => value.trim()).filter((value): value is WarehouseEntityKindV1 =>
        ['artifact', 'note', 'conversation', 'resource', 'context', 'workflow', 'scene', 'collection'].includes(value))
    const usedHereRaw = url.searchParams.get('usedHereTarget')
    let usedHereTarget: WarehouseQueryV1['usedHereTarget'] | undefined
    if (usedHereRaw !== null && usedHereRaw !== '') {
      const separator = usedHereRaw.indexOf(':')
      const kind = separator > 0 ? usedHereRaw.slice(0, separator) : ''
      const id = separator > 0 ? usedHereRaw.slice(separator + 1) : ''
      if (kind === 'workspace' && id !== '') usedHereTarget = { kind: 'workspace', id }
    }
    const originRaw = url.searchParams.get('provenance')
    const provenanceOrigin = originRaw !== null && ['run-return', 'import', 'capture', 'unknown'].includes(originRaw)
      ? originRaw as WarehouseQueryV1['provenanceOrigin']
      : undefined
    const searchRaw = url.searchParams.get('search') ?? undefined
    const limitRaw = url.searchParams.get('limit')
    const cursorRaw = url.searchParams.get('cursor') ?? undefined
    const value: WarehouseSnapshotV1 = warehouse.query(projectId, {
      ...(searchRaw === undefined ? {} : { search: searchRaw }),
      ...(kinds === undefined || kinds.length === 0 ? {} : { kinds }),
      ...(provenanceOrigin === undefined ? {} : { provenanceOrigin }),
      ...(usedHereTarget === undefined ? {} : { usedHereTarget }),
      ...(limitRaw === null || Number.isNaN(Number(limitRaw)) ? {} : { limit: Number(limitRaw) }),
      ...(cursorRaw === undefined ? {} : { cursor: cursorRaw }),
    })
    sendJson(response, 200, { ok: true, value })
    return true
  }

  // ---------- P0-D3：Conversation Reachability ----------
  const reachMatch = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/reach$/.exec(pathname)
  if (method === 'GET' && reachMatch !== null) {
    if (conversationIdentity === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Conversation identity service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(reachMatch[1] ?? '')
    const connectedConversationId = decodeURIComponent(reachMatch[2] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const value: ConversationReachResultV0 | undefined = conversationIdentity.reach(projectId, connectedConversationId)
    if (value === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Connected conversation not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value })
    return true
  }

  // ---------- P0-D5：ResultSlots ----------
  const slotsListMatch = /^\/projects\/([^/]+)\/result-slots$/.exec(pathname)
  if (slotsListMatch !== null && method === 'GET') {
    if (resultSlots === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Result slot service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(slotsListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    sendJson(response, 200, { ok: true, value: resultSlots.list(projectId) })
    return true
  }
  if (slotsListMatch !== null && method === 'POST') {
    if (resultSlots === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Result slot service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(slotsListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Result slot body must be valid JSON.'))
      return true
    }
    if (!isRecord(input)
      || typeof input.scopeId !== 'string' || input.scopeId === ''
      || typeof input.x !== 'number' || typeof input.y !== 'number'
      || (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
      || (input.width !== undefined && typeof input.width !== 'number')
      || (input.height !== undefined && typeof input.height !== 'number')
      || Object.keys(input).some((key) => !['scopeId', 'workspaceId', 'x', 'y', 'width', 'height'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Result slot requires scopeId, x, y; optional workspaceId/width/height.'))
      return true
    }
    try {
      const value: ResultSlotV0 = resultSlots.create({
        projectId,
        scopeId: input.scopeId,
        ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
        x: input.x,
        y: input.y,
        ...(typeof input.width === 'number' ? { width: input.width } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
      })
      sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Result slot creation failed.'))
    }
    return true
  }

  const slotOneMatch = /^\/result-slots\/([^/]+)$/.exec(pathname)
  if (slotOneMatch !== null && method === 'GET') {
    if (resultSlots === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Result slot service is not configured.'))
      return true
    }
    const slot = resultSlots.get(decodeURIComponent(slotOneMatch[1] ?? ''))
    if (slot === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Result slot not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: slot })
    return true
  }
  if (slotOneMatch !== null && method === 'DELETE') {
    if (resultSlots === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Result slot service is not configured.'))
      return true
    }
    try {
      resultSlots.remove(decodeURIComponent(slotOneMatch[1] ?? ''))
      sendJson(response, 200, { ok: true, value: null })
    } catch {
      sendJson(response, 404, failure('NOT_FOUND', 'Result slot not found.'))
    }
    return true
  }

  // ---------- P0-D6：RunRecipe ----------
  const recipeMatch = /^\/runs\/([^/]+)\/recipe$/.exec(pathname)
  if (method === 'GET' && recipeMatch !== null) {
    const runId = decodeURIComponent(recipeMatch[1] ?? '') as RunId
    const run = metadata.getRun(runId)
    if (run === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Run not found.'))
      return true
    }
    const receiverConversationId = metadata.getRunReceiverConversationId(String(runId))
    let receiver: RunRecipeV0['receiver']
    if (receiverConversationId !== undefined && conversationIdentity !== undefined) {
      const chain = conversationIdentity.resolveChain(String(run.projectId), receiverConversationId)
      receiver = {
        connectedConversationId: receiverConversationId,
        ...(chain === undefined ? {} : { provider: chain.connectedConversation.provider }),
      }
    }
    const orderedReferences = metadata.getRunOrderedReferences(String(runId))
    const resultSlotId = metadata.getRunResultSlotId(String(runId))
    const value: RunRecipeV0 = {
      schemaVersion: 0,
      runId: String(runId),
      projectId: String(run.projectId),
      prompt: run.instruction,
      ...(receiver === undefined ? {} : { receiver }),
      intent: run.outputIntent,
      ...(run.targetArtifactId === undefined ? {} : { target: { kind: 'project' as const, id: String(run.projectId) } }),
      orderedReferences,
      ...(run.resultPolicy === undefined ? {} : { resultPolicy: { type: String(run.resultPolicy.type) } }),
      ...(resultSlotId === undefined ? {} : { resultSlotId }),
      ...(run.contextManifestId === undefined ? {} : { contextManifestId: String(run.contextManifestId) }),
      provider: run.provider,
      createdAt: run.createdAt,
    }
    sendJson(response, 200, { ok: true, value })
    return true
  }

  // ---------- P1-A1：Project Summary ----------
  const summaryMatch = /^\/projects\/([^/]+)\/summary$/.exec(pathname)
  if (method === 'GET' && summaryMatch !== null) {
    if (projectSummary === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Project summary service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(summaryMatch[1] ?? '')
    const value: ProjectSummaryV1 | undefined = projectSummary.summary(projectId)
    if (value === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value })
    return true
  }

  // ---------- P1-A2：Project Visual Profile（presentation-only，CAS）----------
  const profileMatch = /^\/projects\/([^/]+)\/visual-profile$/.exec(pathname)
  if (profileMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(profileMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const value = metadata.getProjectVisualProfile(projectId)
    sendJson(response, 200, { ok: true, value })
    return true
  }
  if (profileMatch !== null && method === 'PUT') {
    const projectId = decodeURIComponent(profileMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Visual profile body must be valid JSON.'))
      return true
    }
    const isProfileInput = (value: unknown): value is UpsertProjectVisualProfileInputV0 => isRecord(value)
      && typeof value.tintToken === 'string' && (PROJECT_TINT_TOKENS as readonly string[]).includes(value.tintToken)
      && typeof value.glythMarkId === 'string' && (PROJECT_GLYPH_MARK_REPERTOIRE as readonly string[]).includes(value.glythMarkId)
      && typeof value.expectedVersion === 'number' && Number.isInteger(value.expectedVersion) && value.expectedVersion >= 0
      && (value.glythMarkColor === undefined || (typeof value.glythMarkColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.glythMarkColor)))
      && (value.scale === undefined || (typeof value.scale === 'number' && value.scale >= 0.25 && value.scale <= 4))
      && (value.orientation === undefined || (typeof value.orientation === 'number' && value.orientation >= -180 && value.orientation <= 180))
    if (!isProfileInput(input)
      || Object.keys(input).some((key) => !['tintToken', 'glythMarkId', 'glythMarkColor', 'scale', 'orientation', 'expectedVersion'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Visual profile requires tintToken, glythMarkId (repertoire-only), expectedVersion; optional color/scale/orientation.'))
      return true
    }
    try {
      const value: ProjectVisualProfileV0 = metadata.upsertProjectVisualProfile({
        projectId,
        expectedVersion: input.expectedVersion,
        tintToken: input.tintToken,
        glythMarkId: input.glythMarkId,
        ...(input.glythMarkColor === undefined ? {} : { glythMarkColor: input.glythMarkColor }),
        ...(input.scale === undefined ? {} : { scale: input.scale }),
        ...(input.orientation === undefined ? {} : { orientation: input.orientation }),
      })
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('STALE_VISUAL_PROFILE_VERSION')) {
        sendJson(response, 409, failure('CONFLICT', message))
        return true
      }
      sendJson(response, 400, failure('VALIDATION', message))
    }
    return true
  }

  // ---------- P1-B：Skill Catalog（只读，方案 1）----------
  const skillsListMatch = /^\/projects\/([^/]+)\/skills$/.exec(pathname)
  if (method === 'GET' && skillsListMatch !== null) {
    if (skillCatalog === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Skill catalog service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(skillsListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const search = url.searchParams.get('search') ?? undefined
    const value = await skillCatalog.list(projectId, search)
    sendJson(response, 200, { ok: true, value })
    return true
  }
  const skillOneMatch = /^\/projects\/([^/]+)\/skills\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && skillOneMatch !== null) {
    if (skillCatalog === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Skill catalog service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(skillOneMatch[1] ?? '')
    const skillId = decodeURIComponent(skillOneMatch[2] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    try {
      const value = await skillCatalog.read(skillId, projectId)
      if (value === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Skill not found.'))
        return true
      }
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Skill read failed.'))
    }
    return true
  }

  // ---------- S2：Skill 一等对象 CRUD（写操作物理限定 user 层；system 层写保护）----------
  const requireSkillPackages = (): SkillPackageService | undefined => {
    if (skillPackages === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Skill package service is not configured.'))
      return undefined
    }
    return skillPackages
  }
  const readBody = async (): Promise<Record<string, unknown> | undefined> => {
    try {
      const input = await readJsonBody(request, controller.signal)
      return isRecord(input) ? input : undefined
    } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return undefined
    }
  }
  const respondMutation = (promise: Promise<unknown>): boolean => {
    void promise.then(
      (value) => sendJson(response, 200, { ok: true, value }),
      (error: unknown) => sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Skill operation failed.')),
    )
    return true
  }

  // 结构校验（不落盘）
  const skillValidateMatch = /^\/projects\/([^/]+)\/skills\/validate$/.exec(pathname)
  if (method === 'POST' && skillValidateMatch !== null) {
    const packages = requireSkillPackages(); if (packages === undefined) return true
    const projectId = decodeURIComponent(skillValidateMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const body = await readBody(); if (body === undefined) return true
    if (typeof body.content !== 'string') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'validate requires content (SKILL.md text).'))
      return true
    }
    sendJson(response, 200, { ok: true, value: packages.validate(body.content) })
    return true
  }

  // create
  if (method === 'POST' && skillsListMatch !== null) {
    const packages = requireSkillPackages(); if (packages === undefined) return true
    const projectId = decodeURIComponent(skillsListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const body = await readBody(); if (body === undefined) return true
    if (typeof body.id !== 'string' || typeof body.content !== 'string') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'create requires id and content.'))
      return true
    }
    return respondMutation(packages.create(projectId, body.id, body.content))
  }

  const skillActionMatch = /^\/projects\/([^/]+)\/skills\/([^/]+)\/(update|version-bump|rename|install|disable|enable)$/.exec(pathname)
  if (method === 'POST' && skillActionMatch !== null) {
    const packages = requireSkillPackages(); if (packages === undefined) return true
    const projectId = decodeURIComponent(skillActionMatch[1] ?? '')
    const skillId = decodeURIComponent(skillActionMatch[2] ?? '')
    const action = skillActionMatch[3] ?? ''
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    if (action === 'update') {
      const body = await readBody(); if (body === undefined) return true
      if (typeof body.content !== 'string') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'update requires content.'))
        return true
      }
      return respondMutation(packages.update(projectId, skillId, body.content))
    }
    if (action === 'version-bump') {
      const body = await readBody(); if (body === undefined) return true
      if (typeof body.version !== 'string') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'version-bump requires version (semver).'))
        return true
      }
      return respondMutation(packages.versionBump(projectId, skillId, body.version))
    }
    if (action === 'rename') {
      const body = await readBody(); if (body === undefined) return true
      if (typeof body.newId !== 'string') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'rename requires newId.'))
        return true
      }
      return respondMutation(packages.rename(projectId, skillId, body.newId))
    }
    if (action === 'install') return respondMutation(packages.install(projectId, skillId))
    return respondMutation(packages.setDisabled(projectId, skillId, action === 'disable'))
  }

  // ---------- S3：RunRecipe → Skill Proposal seam（审批通道复用现有 proposal 流）----------
  const requireSkillProposals = (): SkillProposalService | undefined => {
    if (skillProposals === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Skill proposal service is not configured.'))
      return undefined
    }
    return skillProposals
  }

  // Completed Run → Skill Proposal（pending，进现有 proposal 审批位）
  const runSkillProposalMatch = /^\/runs\/([^/]+)\/skill-proposal$/.exec(pathname)
  if (method === 'POST' && runSkillProposalMatch !== null) {
    const proposals = requireSkillProposals(); if (proposals === undefined) return true
    const runId = decodeURIComponent(runSkillProposalMatch[1] ?? '') as RunId
    const run = metadata.getRun(runId)
    if (run === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Run not found.'))
      return true
    }
    if (routeRequireProject(String(run.projectId), { metadata, response, helpers: ctx.helpers }) === undefined) return true
    try {
      const value = await proposals.proposeFromRun(runId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Skill proposal creation failed.'
      sendJson(response, message.includes('RUN_NOT_COMPLETED') ? 409 : 400, failure('INVALID_ARGUMENT', message))
    }
    return true
  }

  const skillProposalsListMatch = /^\/projects\/([^/]+)\/skill-proposals$/.exec(pathname)
  if (method === 'GET' && skillProposalsListMatch !== null) {
    const proposals = requireSkillProposals(); if (proposals === undefined) return true
    const projectId = decodeURIComponent(skillProposalsListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    sendJson(response, 200, { ok: true, value: proposals.list(projectId) })
    return true
  }

  const skillProposalActionMatch = /^\/projects\/([^/]+)\/skill-proposals\/([^/]+)\/(accept|reject)$/.exec(pathname)
  if (method === 'POST' && skillProposalActionMatch !== null) {
    const proposals = requireSkillProposals(); if (proposals === undefined) return true
    const projectId = decodeURIComponent(skillProposalActionMatch[1] ?? '')
    const proposalId = decodeURIComponent(skillProposalActionMatch[2] ?? '')
    const action = skillProposalActionMatch[3] ?? 'accept'
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    try {
      const value = action === 'accept' ? await proposals.accept(projectId, proposalId) : proposals.reject(projectId, proposalId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Skill proposal action failed.'
      sendJson(response, 409, failure('CONFLICT', message))
    }
    return true
  }

  // ---------- S4：Companion Runtime Projection（桌面统一只读投影 owner）----------
  const companionMatch = /^\/projects\/([^/]+)\/companion$/.exec(pathname)
  if (method === 'GET' && companionMatch !== null) {
    if (companionProjections === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Companion projection service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(companionMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    try {
      const value = await companionProjections.project(projectId as ProjectId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Companion projection failed.'))
    }
    return true
  }
  return false
}
