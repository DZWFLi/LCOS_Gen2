// Sprint P0-05（T5）：Connector source view state mapper —— Figma 10 态子集 → 单一 view state。
// 只按 T7 投影 + 本地态推导；auth_required/expired/scanning/partial 等会话生命周期态本 Sprint
// 不产出（通用 lifecycle GAP，诚实不冒充）。

import type { ConnectorSourceProjectionV1 } from '@local-creative-os/contracts';

export type ConnectorSourceViewStateV1 =
  | 'empty'
  | 'not_configured'
  | 'ready'
  | 'unsupported'
  | 'error'
  | 'loading';

export interface ConnectorSourceViewInputV1 {
  readonly sources: readonly ConnectorSourceProjectionV1[] | null;
  readonly readError: boolean;
}

export function connectorSourceViewStateV1(input: ConnectorSourceViewInputV1): ConnectorSourceViewStateV1 {
  if (input.readError) return 'error';
  if (input.sources === null) return 'loading';
  if (input.sources.length === 0) return 'empty';
  if (input.sources.some((source) => source.session.status === 'active')) return 'ready';
  if (input.sources.every((source) => source.allowedActions.length === 0)) return 'unsupported';
  return 'not_configured';
}
