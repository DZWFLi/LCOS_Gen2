import { readFile } from 'node:fs/promises'
import type { ProjectId } from '@local-creative-os/domain'
import type { ProjectionBindingRecord, SqliteMetadataRepository } from './metadata-repository.js'
import { createTextArtifact, reviseManagedTextArtifact } from './text-artifact-service.js'

export interface CanvasTextAddress { readonly canvasId: string; readonly spatialId: string }
export interface CanvasTextSnapshot extends CanvasTextAddress {
  readonly projectId: string; readonly artifactId: string; readonly viewId: string;
  readonly revisionId: string; readonly fileRecordId: string; readonly body: string; readonly title: string;
}
export interface CanvasTextWrite extends CanvasTextAddress {
  /** null explicitly means initial adoption, not an unconditional overwrite. */
  readonly expectedRevisionId: string | null;
  readonly artifactId?: string;
  readonly body: string;
}

function destination(repository: SqliteMetadataRepository, projectId: string, address: CanvasTextAddress) {
  const sites = repository.getWorkspaces(projectId).filter((site) => site.canvasId === address.canvasId)
  if (!address.spatialId.trim() || !address.canvasId.trim() || sites.length !== 1
    || !repository.getScopes(projectId).some((scope) => String(scope.id) === String(sites[0]!.scopeId))) {
    throw new Error('当前画布尚未对应唯一工作现场，未保存正文。')
  }
  return sites[0]!
}
function bindingAt(repository: SqliteMetadataRepository, projectId: string, address: CanvasTextAddress): ProjectionBindingRecord | undefined {
  const matches = repository.getProjectionBindings(projectId).filter((binding) => binding.canvasId === address.canvasId
    && binding.spatialKind === 'node' && binding.spatialId === address.spatialId)
  if (matches.length > 1) throw new Error('当前节点有冲突的材料身份。')
  return matches[0]
}

/** Reads the actual immutable revision body, never a node preview or the latest
 * title alone. A missing binding is an explicit null, not a read failure. */
export async function readCanvasText(repository: SqliteMetadataRepository, projectId: string, address: CanvasTextAddress): Promise<CanvasTextSnapshot | null> {
  const site = destination(repository, projectId, address)
  const binding = bindingAt(repository, projectId, address)
  if (!binding) return null
  const artifact = binding.entityType === 'artifact' ? repository.getArtifact(binding.entityId) : undefined
  if (!artifact || String(artifact.projectId) !== projectId || !artifact.managed || artifact.archivedAt !== undefined
    || !['markdown', 'text'].includes(artifact.kind)) throw new Error('这份材料不支持在此直接改写。')
  const revision = artifact.currentRevisionId ? repository.getArtifactRevision(String(artifact.currentRevisionId)) : undefined
  const file = revision ? repository.getFileRecord(String(revision.fileRecordId)) : undefined
  const views = repository.getArtifactViews(String(artifact.id))
  const view = views.find((item) => String(item.scopeId) === String(site.scopeId))
  if (!revision || !file || String(file.projectId) !== projectId || !view) throw new Error('正文版本或现场引用不可读取。')
  const body = await readFile(file.observedPath, 'utf8')
  // A read that raced another writer is a conflict, never a draft based on a
  // different revision than the one actually returned to the editor.
  const current = repository.getArtifact(String(artifact.id))
  const after = bindingAt(repository, projectId, address)
  if (String(current?.currentRevisionId) !== String(revision.id) || current?.archivedAt !== undefined
    || after?.entityType !== 'artifact' || after.entityId !== String(artifact.id)) throw new Error('读取期间材料发生变化，请重读正文。')
  return { canvasId: address.canvasId, spatialId: address.spatialId, projectId, artifactId: String(artifact.id), viewId: String(view.id),
    revisionId: String(revision.id), fileRecordId: String(file.id), body, title: artifact.title }
}

/** The existing native node is the idempotency identity. No new operation
 * registry; create + initial working-set membership + binding share one tx. */
export async function saveCanvasText(repository: SqliteMetadataRepository, projectId: string, input: CanvasTextWrite): Promise<CanvasTextSnapshot> {
  const site = destination(repository, projectId, input)
  const current = await readCanvasText(repository, projectId, input)
  if (current !== null) {
    if (input.artifactId !== undefined && input.artifactId !== current.artifactId) throw new Error('当前节点已换成另一份材料。')
    // Reconcile a lost reply without generating another revision or new object.
    if (current.body === input.body && (input.expectedRevisionId === null || input.artifactId === current.artifactId)) return current
    if (input.expectedRevisionId === null || input.artifactId !== current.artifactId
      || input.expectedRevisionId !== current.revisionId) throw new Error('正文已有新版本；草稿保留，请先核对。')
    await reviseManagedTextArtifact(repository, projectId as ProjectId, { artifactId: current.artifactId, viewId: current.viewId }, input.body, {
      expectedRevisionId: input.expectedRevisionId,
      binding: { projectId, canvasId: input.canvasId, spatialId: input.spatialId, spatialKind: 'node', entityType: 'artifact', entityId: current.artifactId },
    })
  } else {
    if (input.expectedRevisionId !== null || input.artifactId !== undefined) throw new Error('原材料绑定已消失；不会另造替代材料。')
    try {
      await createTextArtifact(repository, projectId as ProjectId, { body: input.body,
        scopeId: String(site.scopeId), workspaceId: String(site.id), nativeBinding: { canvasId: input.canvasId, spatialId: input.spatialId } })
    } catch (error) {
      // A concurrent initial adoption can only be treated as satisfied when
      // the committed binding and exact body agree; all other errors surface.
      const observed = await readCanvasText(repository, projectId, input).catch(() => null)
      if (observed?.body === input.body) return observed
      throw error
    }
  }
  const saved = await readCanvasText(repository, projectId, input)
  if (!saved || saved.body !== input.body) throw new Error('保存结果尚未确认，请核对原节点。')
  return saved
}
