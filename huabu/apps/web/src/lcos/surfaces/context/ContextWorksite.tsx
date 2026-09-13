// ContextWorksite — Context 现场（Figma context 5388:21602）：真实画布舞台 + 现场仪器
// （Atlas 强表征 / Temporal Rail 局部时间轨 / 来源与关系 Wave 8）。Atlas=Context 现场表征，
// 不是全局 overlay；child canvas 复用同一 Huabu kernel（Portal/Surface 机制 Wave 8 精化）。

import { Layers } from 'lucide-react';
import { useState } from 'react';


import { ContextAtlasStage } from './ContextAtlasStage';
import { TemporalRail } from './TemporalRail';
import { useLcosWorksiteNav } from '../../app/useLcosWorksiteNav';
import { LcosWorksiteStage } from '../../shell/LcosWorksiteStage';
import { lcosTokens } from '../../ui/lcosTokens';

import type { LcosSurfaceKey } from '../../shell/lcosShellStore';
import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export interface ContextWorksiteProps {
  readonly projectId: string;
  readonly surface: LcosSurfaceKey;
  readonly canvasId?: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey) => Promise<string | undefined>;
}

export function ContextWorksite({
  projectId,
  surface,
  canvasId,
  canvasBySurface,
  ensureCanvas,
}: ContextWorksiteProps): React.JSX.Element {
  const [atlasOpen, setAtlasOpen] = useState(false);
  const { switchWorksite } = useLcosWorksiteNav({ projectId, canvasBySurface, ensureCanvas });

  const enterItem = (item: WarehouseItemV1): void => {
    // scene → 真实 worksite 切换；其余（conversation/workflow）先关 Atlas 保持现场
    if (item.kind === 'scene') {
      void switchWorksite('context').then(() => setAtlasOpen(false));
      return;
    }
    setAtlasOpen(false);
  };

  return (
    <div data-lcos-context-worksite className="relative h-full w-full">
      <LcosWorksiteStage
        projectId={projectId}
        surface={surface}
        canvasId={canvasId}
        ensureCanvas={() => ensureCanvas(surface)}
      />

      {/* Context 现场仪器入口（真实动作；Temporal Rail 常驻右侧） */}
      <div className="pointer-events-auto fixed left-6 bottom-24 z-30 flex flex-col gap-2">
        <button
          type="button"
          data-lcos-context-instrument="atlas"
          onClick={() => setAtlasOpen(true)}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
          style={{
            background: 'rgba(252,252,252,0.86)',
            backdropFilter: 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
            border: '1px solid rgba(0,0,0,0.09)',
            boxShadow: '0 4px 12px rgba(40,48,58,0.075)',
            minHeight: 44,
            color: lcosTokens.color.text.light,
          }}
        >
          <Layers className="h-4 w-4" aria-hidden />
          Atlas
        </button>
      </div>

      <TemporalRail />

      {atlasOpen && (
        <ContextAtlasStage
          projectId={projectId}
          onClose={() => setAtlasOpen(false)}
          onEnterSurface={enterItem}
        />
      )}
    </div>
  );
}