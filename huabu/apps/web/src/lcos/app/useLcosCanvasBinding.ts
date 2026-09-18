// useLcosCanvasBinding — `/canvas/:canvasId` → 「项目 + 显式工作现场」的 canonical 解析。
//
// 依据（正本 `03_...总装源码蓝图正本.md` §3、`appendices\B`、`04` Wave 1）：
// projectId 必须来自真实 Core binding，不得用 canvas title、环境变量或「当前 canvasId」猜。
// Core 没有 canvasId→project 反查端点，因此只走 canonical 列表：
//   GET /projects → 逐个 GET /projects/:projectId/workspaces（workspace 带 stable canvasId）
//   → 线性匹配 workspace.canvasId === canvasId。
// 查不到归属时返回 `unbound`，由调用方诚实展示，不伪造项目、不回落到旧壳。
//
// 注意（实测教训）：**不要**用「已解析过就 early-return」的 ref 守卫。React StrictMode
// 下 effect 会 mount→cleanup→mount，第一次的异步被 cleanup 取消，第二次若 early-return
// 就永远不会发起查询 —— 表现是永久停在 `resolving`（Wave 1 浏览器验收实测到过）。
// 查询是幂等只读，允许重复执行；正确性只由 `cancelled` 保证。

import { useEffect, useState } from 'react';

import { createLcosCoreSession } from './lcosCoreClient';

import type { LcosSurfaceKey } from '../shell/lcosShellStore';

export type LcosCanvasBinding =
  | { readonly kind: 'resolving' }
  | {
      readonly kind: 'resolved';
      readonly projectId: string;
      readonly workspaceId: string;
      readonly surface: LcosSurfaceKey;
    }
  | { readonly kind: 'unbound' }
  | { readonly kind: 'error'; readonly message: string };

const SURFACE_KEYS: ReadonlySet<string> = new Set(['main', 'context', 'workflow']);

export function useLcosCanvasBinding(canvasId: string | undefined): LcosCanvasBinding {
  const [binding, setBinding] = useState<LcosCanvasBinding>({ kind: 'resolving' });

  useEffect(() => {
    if (canvasId === undefined || canvasId === '') return;
    let cancelled = false;
    setBinding({ kind: 'resolving' });

    void (async () => {
      try {
        const session = createLcosCoreSession();
        const projects = await session.projects.listProjects();
        for (const project of projects) {
          const workspaces = await session.projects.getWorkspaces(project.id);
          if (cancelled) return;
          const hit = workspaces.find((workspace) => workspace.canvasId === canvasId);
          if (hit !== undefined) {
            const preferred = typeof hit.preferredSurface === 'string' ? hit.preferredSurface : '';
            setBinding({
              kind: 'resolved',
              projectId: project.id,
              workspaceId: String(hit.id),
              surface: SURFACE_KEYS.has(preferred) ? (preferred as LcosSurfaceKey) : 'main',
            });
            return;
          }
        }
        if (!cancelled) setBinding({ kind: 'unbound' });
      } catch (error) {
        if (!cancelled) {
          setBinding({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  return binding;
}