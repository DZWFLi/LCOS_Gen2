import type {
  AffinityReasonV0,
  ProjectAffinityCandidateV0,
  ProjectAffinityInputV0,
  ProjectAffinityResultV0,
} from '@local-creative-os/contracts'
import { isContained } from './path-guard.js'
import type { RuntimeRegistryV0 } from './runtime-registry-service.js'

export interface SessionProjectBindingV0 {
  readonly sessionId: string
  readonly projectId: string
  readonly source: 'agent_bind' | 'gui_launch' | 'bridge'
  readonly openedAt: string
  readonly closedAt?: string
}

export interface ProjectAffinityOptions {
  readonly projectRoots: readonly { readonly projectId: string; readonly rootPath: string }[]
  readonly registry: RuntimeRegistryV0
  readonly sessionBindings?: readonly SessionProjectBindingV0[]
  readonly now?: string
}

const DIRECT_THRESHOLD = 0.8

function scoreFor(projectId: string, score: number, reason: AffinityReasonV0): ProjectAffinityCandidateV0 {
  return { projectId, score, reason }
}

/**
 * Phase B：确定性 Project Affinity Resolver。
 * 规则顺序固定：explicit > session > path > local agent browser > browser tab
 * > pinned > recent focus > semantic hint（Phase F 槽）> recent project。
 * >=0.8 返回 direct projectId；否则只给 candidates（由调用方进 Staging）。
 */
export function resolveProjectAffinity(input: ProjectAffinityInputV0, options: ProjectAffinityOptions): ProjectAffinityResultV0 {
  const candidates: ProjectAffinityCandidateV0[] = []

  // 1. explicit —— 用户/调用方显式指定
  if (input.explicitProjectId !== undefined) {
    return { projectId: input.explicitProjectId, confidence: 1, reason: 'explicit', candidates: [scoreFor(input.explicitProjectId, 1, 'explicit')] }
  }

  // 2. session_bound —— 当前 Agent Session 已 bind 项目
  if (input.sessionId !== undefined) {
    const binding = (options.sessionBindings ?? []).find((item) => item.sessionId === input.sessionId && item.closedAt === undefined)
    if (binding !== undefined) {
      candidates.push(scoreFor(binding.projectId, 1, 'session_bound'))
      return { projectId: binding.projectId, confidence: 1, reason: 'session_bound', candidates }
    }
  }

  // 3. path_inside_root —— 本地文件落在已注册 Project Root 内（最长 root 优先）
  if (input.localPath !== undefined && input.localPath.length > 0) {
    const matches = options.projectRoots
      .filter((project) => isContained(project.rootPath, input.localPath as string))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)
    if (matches.length > 0) {
      candidates.push(scoreFor(matches[0]!.projectId, 1, 'path_inside_root'))
      return { projectId: matches[0]!.projectId, confidence: 1, reason: 'path_inside_root', candidates }
    }
  }

  // 4/5. local agent browser / browser tab —— 通过注入的绑定（Phase C 由 Capture Gateway 提供）
  if (input.browser !== undefined && input.browser.profileId !== undefined && input.browser.tabId !== undefined) {
    const boundProjectId = options.registry.browserTabBindings?.[`${input.browser.profileId}:${input.browser.tabId}`]
    if (boundProjectId !== undefined) {
      candidates.push(scoreFor(boundProjectId, 0.98, 'browser_tab_bound'))
      return { projectId: boundProjectId, confidence: 0.98, reason: 'browser_tab_bound', candidates }
    }
  }

  // 6. pinned_capture_target —— 用户显式钉住（0.99，优先 recent focus）
  if (options.registry.pinnedCaptureProjectId !== undefined) {
    candidates.push(scoreFor(options.registry.pinnedCaptureProjectId, 0.99, 'pinned_capture_target'))
    return { projectId: options.registry.pinnedCaptureProjectId, confidence: 0.99, reason: 'pinned_capture_target', candidates }
  }

  // 7. recent_focus —— 弱信号，按时间衰减
  if (options.registry.lastFocusedProjectId !== undefined) {
    const focused = options.registry.recentProjects.find((project) => project.projectId === options.registry.lastFocusedProjectId)
    const focusedAt = focused?.lastFocusedAt ?? focused?.lastOpenedAt
    if (focusedAt !== undefined) {
      const ageMinutes = (Date.parse(options.now ?? new Date().toISOString()) - Date.parse(focusedAt)) / 60_000
      const score = ageMinutes <= 10 ? 0.9 : ageMinutes <= 30 ? 0.82 : 0.75
      const candidate = scoreFor(options.registry.lastFocusedProjectId, score, 'recent_focus')
      candidates.push(candidate)
      if (score >= DIRECT_THRESHOLD) {
        return { projectId: options.registry.lastFocusedProjectId, confidence: score, reason: 'recent_focus', candidates }
      }
    }
  }

  // 8. semantic_hint —— Phase F 前不激活（只留槽位）
  // 9. recent_project —— 0.55，永远不 direct，只作候选
  const recent = options.registry.recentProjects[0]
  if (recent !== undefined) {
    candidates.push(scoreFor(recent.projectId, 0.55, 'recent_project'))
  }

  if (candidates.length === 0) {
    return { confidence: 0, reason: 'unknown', candidates: [] }
  }
  return { confidence: 0, reason: 'unknown', candidates }
}
