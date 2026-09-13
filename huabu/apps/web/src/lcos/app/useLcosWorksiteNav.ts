// useLcosWorksiteNav — 现场切换唯一控制器（Dock / Railway / Navigator 共用同一逻辑与错误态）。
// 切换 = switchCanvas（真实 canvasId）或 createCanvas + 回写（首进）；失败保持现场不冒充。

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';

export interface WorksiteNavHandle {
  readonly busySurface: LcosSurfaceKey | null;
  readonly transitionError: string | undefined;
  switchWorksite(surface: LcosSurfaceKey): Promise<void>;
}

export function useLcosWorksiteNav(opts: {
  projectId: string;
  canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}): WorksiteNavHandle {
  const navigate = useNavigate();
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const [busySurface, setBusySurface] = useState<LcosSurfaceKey | null>(null);
  const [transitionError, setTransitionError] = useState<string | undefined>(undefined);

  const switchWorksite = useCallback(
    async (surface: LcosSurfaceKey): Promise<void> => {
      if (busySurface === surface) return;
      setTransitionError(undefined);
      const existing = opts.canvasBySurface[surface];
      setActiveSurface(surface);
      try {
        if (existing !== undefined) {
          await useCanvasStore.getState().switchCanvas(existing);
        } else {
          setBusySurface(surface);
          const created = await opts.ensureCanvas(surface);
          if (created !== undefined) {
            await useCanvasStore.getState().switchCanvas(created);
          }
        }
        navigate(`/projects/${encodeURIComponent(opts.projectId)}/${surface}`, { replace: true });
      } catch (error) {
        setTransitionError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusySurface(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts 由父级每次渲染重建同一引用的字段；闭包字段已全部解构使用
    [busySurface, navigate, opts.ensureCanvas, opts.canvasBySurface, opts.projectId, setActiveSurface],
  );

  return { busySurface, transitionError, switchWorksite };
}
