// LcosRailway — 左缘现场导航脊柱（Figma Railway 5385:283；左 24 居中、宽 52、高随 items）。
// 数据：三现场（真实 canvasId 切换）；durable view order（CoreRailwayClient.read）可用时
// 追加长期 worksite 条目；reorder / Receive / +N 溢出 → Wave 9 补（当前诚实不伪造）。

import { CoreRailwayClient } from '@local-creative-os/web-gen2';
import { Layers, ListTree, PanelsTopLeft } from 'lucide-react';
import { useEffect, useState } from 'react';


import { LCOS_SURFACES, useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { LcosRailwayView, type LcosRailwayViewItem } from '../ui/families';

const SURFACE_ICON: Readonly<Record<LcosSurfaceKey, React.ComponentType<{ className?: string }>>> = {
  main: PanelsTopLeft,
  context: Layers,
  workflow: ListTree,
};

export interface LcosRailwayProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

export function LcosRailway({ projectId, canvasBySurface, ensureCanvas }: LcosRailwayProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const { busySurface, switchWorksite } = useLcosWorksiteNav({ projectId, canvasBySurface, ensureCanvas });
  // durable rail order 读取（真实 Core；不可用时不驻留 localStorage 伪持久化；reorder/+N 溢出 Wave 9）。
  const [railInfo, setRailInfo] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = new CoreRailwayClient(
          (await import('../app/lcosCoreClient')).createLcosCoreSession().http,
        );
        const order = await client.read(projectId);
        if (cancelled) return;
        if (order?.orderedRefs && order.orderedRefs.length > 0) {
          setRailInfo(`+${order.orderedRefs.length} 个长期现场`);
        }
      } catch {
        if (!cancelled) setRailInfo('rail order 读取失败（默认现场骨架）');
      }
    })();
    return () => {
      cancelled = true;
    };
     
  }, [projectId]);

  const items: readonly LcosRailwayViewItem[] = LCOS_SURFACES.map(({ key, label }) => ({
    key,
    label,
    icon: SURFACE_ICON[key],
    selected: activeSurface === key,
    disabled: busySurface === key,
  }));

  return (
    <div
      data-lcos-railway
      className="pointer-events-auto fixed left-6 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-2"
    >
      <LcosRailwayView
        items={items}
        onSelect={(key) => void switchWorksite(key as LcosSurfaceKey)}
        footer={railInfo}
      />
    </div>
  );
}
