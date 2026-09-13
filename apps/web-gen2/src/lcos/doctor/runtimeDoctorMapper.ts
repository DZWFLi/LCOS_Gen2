// Sprint P0-09（T5）：Runtime Doctor view state mapper —— Figma 11 态子集 → 单一 view state。
// 只按 /health 读取结果推导；degraded/version_mismatch/not_installed/restart_required/repair_failed
// 需 T7 host 证据（GAP）不产出；repair 为 T7 固定 allowlist GAP → 无 repairing 态。
// details / copied 为 healthy 下的展开/剪贴板修饰态（body 本地持有），不占主 view state。

import type { HealthStatus } from '@local-creative-os/contracts';

export type RuntimeDoctorViewStateV1 = 'loading' | 'healthy' | 'offline' | 'unknown';

export interface RuntimeDoctorViewInputV1 {
  readonly health: HealthStatus | null;
  readonly readError: boolean;
  /** 网络/5xx 不可达 → offline；其它异常（如响应畸形）→ unknown。 */
  readonly offlineLikely: boolean;
}

export function runtimeDoctorViewStateV1(input: RuntimeDoctorViewInputV1): RuntimeDoctorViewStateV1 {
  if (input.health !== null) return 'healthy';
  if (!input.readError) return 'loading';
  return input.offlineLikely ? 'offline' : 'unknown';
}
