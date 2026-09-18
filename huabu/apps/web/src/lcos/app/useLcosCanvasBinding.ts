// useLcosCanvasBinding — `/canvas/:canvasId` → 「项目 + 显式工作现场」的 canonical 解析。
//
// 依据（正本 `03_...总装源码蓝图正本.md` §3、`appendices\B`、`04` Wave 1）：
// projectId 必须来自真实 Core binding，不得用 canvas title、环境变量或「当前 canvasId」猜。
// Core 没有 canvasId→project 反查端点，因此只走 canonical 列表：
//   GET /projects → 逐个 GET /projects/:projectId/workspaces（workspace 带 stable canvasId）
//   → 线性匹配 workspace.canvasId === canvasId。
// 查不到归属时返回 `unbound`，由调用方诚实展示，不伪造项目、不回落到旧壳。

import { useEffect, useRef, useState } from 'react';

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
  const resolvedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (canvasId === undefined || canvasId === '') {
      resolvedFor.current = undefined;
      return;
    }
    if (resolvedFor.current === canvasId) return;
    resolvedFor.current = canvasId;
    let cancelled = false;

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