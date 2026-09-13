// lcosHostState — 当前会话 Gen2 host 的响应式透传（机制从 archive c47a1b4 收编）。
// 同一 project session 可能 retarget（换 canvas → 新 Gen2Host）；overlay/控制器若冻结
// 初始 host 会查不到当前画布 binding。runtime 创建/retarget/unmount 时写入本 store，
// useLcosHost 从 store 读取当前 host。

import { create } from 'zustand';

import type { Gen2Host } from '@local-creative-os/web-gen2';

export interface LcosHostState {
  readonly host: Gen2Host | null;
  setHost(host: Gen2Host | null): void;
}

export const useLcosHostStore = create<LcosHostState>((set) => ({
  host: null,
  setHost: (host) => set({ host }),
}));