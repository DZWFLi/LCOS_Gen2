// RecoverySection — 续工操作恢复（Figma P0-08 RecoverySectionBody 语义）。
// 挂在 Conversation Work View 的 continuation section：allowedActions 由 T6 read projection 提供，
// 前端不推断；点击 → CoreContinuationClient.executeRecoveryAction（T6 service → T7 adapter → receipt），
// 成功后用返回的 fresh projection 更新（重复 retry 不重复 create 由 Core journal/幂等保证）。

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';


import { lcosTokens } from '../ui/lcosTokens';

import type { ContinuationActionV1, ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';
import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';


const ACTION_LABEL: Readonly<Record<string, string>> = {
  retry_external_create: '重试外部会话',
  recover_bind: '恢复绑定',
  retry_attach: '重试附加',
  retry_projection: '重试投影',
  reconcile: '核对外部状态',
  cancel_request: '取消该操作',
};

export interface RecoverySectionProps {
  readonly collaboration: CoreCollaborationClient;
  readonly projectId: string;
  readonly operations: readonly ContinuationRecoveryProjectionV1[];
  readonly onRefreshed: (projection: ContinuationRecoveryProjectionV1) => void;
}

export function RecoverySection({ collaboration, projectId, operations, onRefreshed }: RecoverySectionProps): React.JSX.Element | null {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [receipt, setReceipt] = useState<string | null>(null);

  const run = useCallback(
    (operation: ContinuationRecoveryProjectionV1, action: ContinuationActionV1): void => {
      const key = `${operation.operationId}:${action}`;
      setBusyKey(key);
      setErrorDetail(undefined);
      setReceipt(null);
      void collaboration
        .recover(projectId, {
          continuationOperationId: operation.operationId,
          action,
          expectedRevision: operation.revision,
        })
        .then((result) => {
          if (!result.ok) throw new Error(result.error.userMessage);
          setReceipt(`已执行 · ${operation.operationId.slice(0, 8)}`);
          // 恢复动作后重取 diagnostics projection（会话 store 走既有 SSE/手动 refresh）。
          void collaboration.readDiagnostics(projectId, operation.connectedConversationId ?? '');
          onRefreshed(operation);
        })
        .catch((error: unknown) => {
          setErrorDetail(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setBusyKey(null));
    },
    [collaboration, projectId, onRefreshed],
  );

  useEffect(() => {
    if (errorDetail === undefined && receipt === null) return;
    const timer = window.setTimeout(() => {
      setErrorDetail(undefined);
      setReceipt(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [errorDetail, receipt]);

  if (operations.length === 0) {
    return (
      <div data-lcos-recovery-section data-empty="true" className="rounded-xl px-3 py-2" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          没有待恢复的续工操作
        </span>
      </div>
    );
  }

  return (
    <div data-lcos-recovery-section className="flex flex-col gap-2">
      {operations.map((operation) => (
        <div
          key={operation.operationId}
          className="flex flex-col gap-2 rounded-xl p-3"
          style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
        >
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" style={{ color: lcosTokens.color.pinViolet }} aria-hidden />
            <span className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>
              续工 · {operation.operationId.slice(0, 8)}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
              {operation.status} · {operation.mode} · {operation.provider}
            </span>
          </div>

          <div className="flex flex-wrap gap-1">
            {Object.entries(operation.steps).map(([step, state]) => (
              <span
                key={step}
                data-lcos-recovery-step={step}
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  background: state === 'confirmed' ? 'rgba(84,116,100,0.10)' : lcosTokens.color.raised,
                  color: state === 'failed' ? lcosTokens.color.danger : lcosTokens.color.muted,
                }}
              >
                {step} · {state}
              </span>
            ))}
          </div>

          {operation.errorEvidence && (
            <span className="break-all text-[10px]" style={{ color: lcosTokens.color.danger }}>
              {operation.errorEvidence}
            </span>
          )}

          {operation.allowedActions.length === 0 ? (
            <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
              当前没有允许的恢复动作（guard 未放行）
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {operation.allowedActions.map((descriptor) => {
                const key = `${operation.operationId}:${descriptor.action}`;
                return (
                  <button
                    key={descriptor.action}
                    type="button"
                    data-lcos-recovery-action={descriptor.action}
                    disabled={busyKey === key}
                    title={descriptor.reason ?? (descriptor.requiresFreshRead ? '需要先读取最新状态' : undefined)}
                    onClick={() => run(operation, descriptor.action)}
                    className="rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-40"
                    style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 30 }}
                  >
                    {busyKey === key ? '执行中…' : (ACTION_LABEL[descriptor.action] ?? descriptor.action)}
                    {descriptor.requiresFreshRead ? ' · 需新读' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {receipt && <span className="text-xs" style={{ color: lcosTokens.color.accent }}>{receipt}</span>}
      {errorDetail && <span className="text-xs" style={{ color: lcosTokens.color.danger }}>恢复动作失败 · {errorDetail}</span>}
    </div>
  );
}