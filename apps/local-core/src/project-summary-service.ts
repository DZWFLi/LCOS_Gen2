/**
 * F6 P1-A1（20260828）：ProjectSummary——Launcher 的项目卡片数据源。
 * 纯 read projection（repository 聚合查询 + 既有 list 函数），零新表。
 */
import type { ProjectSummaryV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

export class ProjectSummaryService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  summary(projectId: string): ProjectSummaryV1 | undefined {
    const project = this.repository.getProject(projectId)
    if (project === undefined) return undefined
    // objectCount 口径冻结（施工单 §5）：user-visible canonical objects。
    // internal row / revision / runtime event / conversation 一律不计。
    const artifacts = this.repository.getArtifacts(projectId).length
    const notes = this.repository.getNotes(projectId).length
    const resources = this.repository.listResourceDescriptors(projectId).length
    const lastMeaningfulEditedAt = this.repository.lastMeaningfulEditedAt(projectId)
    return {
      schemaVersion: 1,
      projectId,
      name: project.name,
      objectCount: artifacts + notes + resources,
      objectCountDetail: { artifacts, notes, resources },
      ...(lastMeaningfulEditedAt === undefined ? {} : { lastMeaningfulEditedAt }),
    }
  }

  /** Launcher 全列表（每个 project 一行 summary）。 */
  list(): readonly ProjectSummaryV1[] {
    return this.repository.listProjects()
      .map((project) => this.summary(String(project.id)))
      .filter((entry): entry is ProjectSummaryV1 => entry !== undefined)
  }
}