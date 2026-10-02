import type { CanvasTextSnapshot, CanvasTextWrite } from '@local-creative-os/web-gen2';

/** A reply cannot bind a different node, a different project or different text. */
export function canvasTextReplyMatches(projectId: string, sent: CanvasTextWrite, reply: CanvasTextSnapshot): boolean {
  return reply.projectId === projectId && reply.canvasId === sent.canvasId && reply.spatialId === sent.spatialId
    && reply.body === sent.body && !!reply.artifactId && !!reply.revisionId && !!reply.viewId && !!reply.fileRecordId
    && (sent.artifactId === undefined || sent.artifactId === reply.artifactId);
}

/** A successful old save is not permission to replace a node that now displays
 * another entity. Unbound and matching carriers may take the reply. */
export function canvasTextCarrierMatches(entity: { readonly entityType: string; readonly entityId: string } | undefined,
  reply: CanvasTextSnapshot): boolean {
  return entity === undefined || entity.entityType === 'artifact' && entity.entityId === reply.artifactId;
}
