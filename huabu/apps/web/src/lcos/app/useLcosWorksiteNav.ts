// useLcosWorksiteNav — 一级 Surface 切换唯一控制器（Dock / Navigator / FocusWhere 共用）。
// 切换 = switchCanvas（真实 canvasId）或 createCanvas + 回写（首进）；失败保持现场不冒充。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import useCanvasStore from '@/store/canvasStore';

import {
  useLcosShellStore,
  type LcosSurfaceKey,
} from '../shell/lcosShellStore';

export interface WorksiteNavHandle {
  readonly busySurface: LcosSurfaceKey | null;
  readonly transitionError: string | undefined;
  switchWorksite(surface: LcosSurfaceKey): Promise<boolean>;
}

export function useLcosWorksiteNav(opts: {
  projectId: string;
  canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  ensureCanvas: (
    surface: LcosSurfaceKey,
    force?: boolean,
  ) => Promise<string | undefined>;
}): WorksiteNavHandle {
  const navigate = useNavigate();
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const [busySurface, setBusySurface] = useState<LcosSurfaceKey | null>(null);
  const switching = useRef(false);
  const mounted = useRef(true);
  const currentProject = useRef(opts.projectId);
  currentProject.current = opts.projectId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [transitionError, setTransitionError] = useState<string | undefined>(
    undefined,
  );

  const switchWorksite = useCallback(
    async (surface: LcosSurfaceKey): Promise<boolean> => {
      // React state updates are deferred: two requests in the same event turn
      // must not both flush/switch the shared canvas before the next render.
      if (switching.current) return false;
      switching.current = true;
      const previousSurface = useLcosShellStore.getState().activeSurface;
      const isCurrent = (): boolean => mounted.current && currentProject.current === opts.projectId;
      setTransitionError(undefined);
      const existing = opts.canvasBySurface[surface];
      setBusySurface(surface);
      try {
        const canvasId = existing ?? (await opts.ensureCanvas(surface));
        if (!isCurrent()) return false;
        if (canvasId === undefined) {
          throw new Error('该工作现场还没有可用画布');
        }
        const loaded = await useCanvasStore.getState().switchCanvas(canvasId);
        if (!isCurrent()) return false;
        if (!loaded) {
          const failure = useCanvasStore.getState().canvasLoadFailure;
          throw new Error(failure?.canvasId === canvasId ? failure.message : '未能进入目标现场，请重试');
        }
        setActiveSurface(surface);
        navigate(`/projects/${encodeURIComponent(opts.projectId)}/${surface}`, {
          replace: true,
        });
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        setActiveSurface(previousSurface);
        setTransitionError(
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        switching.current = false;
        setBusySurface(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opts 由父级每次渲染重建同一引用的字段；闭包字段已全部解构使用
    [
      navigate,
      opts.ensureCanvas,
      opts.canvasBySurface,
      opts.projectId,
      setActiveSurface,
    ],
  );

  return { busySurface, transitionError, switchWorksite };
}
