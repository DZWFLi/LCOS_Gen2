import { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { selectConfirmedSendOperation } from './confirmedConversationOperation';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { useLcosShellStore, type LcosComposerTarget } from '../shell/lcosShellStore';

import type { CollaborationDiagnosticsV1 } from '@local-creative-os/contracts';

type ReadState = {
  readonly key: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly value?: CollaborationDiagnosticsV1;
};

/** Nearfield and Work View prepare the same shell Composer; this owns no conversation state. */
export function useComposerContinuation(projectId: string, target: LcosComposerTarget | null, open: boolean) {
  const enabled = open && target?.intent === 'continue';
  const conversationId = enabled ? target?.receiverConversationId : undefined;
  const entry = useCollaborationSession(conversationId ? projectId : null, conversationId);
  const session = useMemo(() => createLcosCoreSession(), []);
  const client = useMemo(() => new CoreCollaborationClient(session.http), [session]);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<ReadState | null>(null);
  const key = conversationId === undefined ? '' : projectId + ':' + conversationId;
  const projection = entry?.status === 'ready' ? entry.projection : undefined;
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    setRead({ key, status: 'loading' });
    void client.readDiagnostics(projectId, conversationId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setRead(value?.conversationId === conversationId
        ? { key, status: 'ready', value }
        : { key, status: 'error' });
    }).catch(() => {
      if (!controller.signal.aborted) setRead({ key, status: 'error' });
    });
    return () => controller.abort();
  }, [client, projectId, conversationId, key, attempt, projection]);

  const currentRead = read?.key === key ? read : null;
  const operation = conversationId ? selectConfirmedSendOperation(
    currentRead?.value, conversationId, target?.continuationOperationId,
  ) : undefined;
  const retry = useCallback(() => {
    if (!conversationId) return;
    setAttempt((value) => value + 1);
    void useCollaborationSessionStore.getState().refresh(projectId, conversationId);
  }, [projectId, conversationId]);

  useEffect(() => {
    if (!enabled || !target || !operation || projection?.capabilities.canSend !== true) return;
    if (target.continuationOperationId !== undefined && target.messageId !== undefined
      && target.receiverBlockedReason === undefined) return;
    useLcosShellStore.getState().prepareComposerContinuation(projectId, target, operation.operationId);
  }, [enabled, operation, projection, projectId, target]);

  const error = enabled && (entry?.status === 'error' || currentRead?.status === 'error');
  const blockedReason = !enabled ? undefined
    : !conversationId ? '当前会话身份尚未解析'
      : error ? '暂时无法读取会话状态，请重试'
        : !projection || currentRead?.status !== 'ready' ? '正在准备当前会话…'
          : projection.capabilities.canSend !== true ? projection.capabilityReasons?.canSend ?? '当前会话暂不能追加消息'
            : !operation ? '当前会话需要先连接或恢复'
              : target?.continuationOperationId === undefined || target.messageId === undefined ? '正在准备输入…'
                : undefined;
  return { blockedReason, retry, error, diagnostics: currentRead?.status === 'ready' ? currentRead.value : undefined };
}
