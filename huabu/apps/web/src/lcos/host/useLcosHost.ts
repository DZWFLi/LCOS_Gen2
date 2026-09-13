// useLcosHost — 读取当前会话 host（store 透传，retarget 后不冻结）。
import { useLcosHostStore } from './lcosHostState';

export function useLcosHost() {
  return useLcosHostStore((s) => s.host);
}