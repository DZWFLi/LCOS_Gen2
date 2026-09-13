// WorkflowWorksite — Workflow 现场（Figma workflow 5388:22998）：真实卡片舞台 + 手牌/卡池仪器。
// 手牌 = 现场表征（非第二 graph）；取用 → 加入 Composer 草稿（未发送，真实动作）；
// 打开/续接（Run 执行）Wave 8 接 T6 Run 事实。

import { Hand, X } from 'lucide-react';
import { useState } from 'react';

import { WorkflowCardPool } from './WorkflowCardPool';
import { LcosWorksiteStage } from '../../shell/LcosWorksiteStage';
import { lcosTokens } from '../../ui/lcosTokens';

import type { LcosSurfaceKey } from '../../shell/lcosShellStore';

export interface WorkflowWorksiteProps {
  readonly projectId: string;
  readonly surface: LcosSurfaceKey;
  readonly canvasId?: string;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

export function WorkflowWorksite({
  projectId,
  surface,
  canvasId,
  ensureCanvas,
}: WorkflowWorksiteProps): React.JSX.Element {
  const [handOpen, setHandOpen] = useState(false);

  return (
    <div data-lcos-workflow-worksite className="relative h-full w-full">
      <LcosWorksiteStage
        projectId={projectId}
        surface={surface}
        canvasId={canvasId}
        ensureCanvas={(recreate?: boolean) => ensureCanvas(surface, recreate)}
      />

      {/* 手牌呼出（真实：卡池） */}
      <div className="pointer-events-auto fixed left-6 bottom-24 z-30 flex flex-col gap-2">
        <button
          type="button"
          data-lcos-workflow-hand-toggle
          onClick={() => setHandOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
          style={{
            background: 'rgba(252,252,252,0.86)',
            backdropFilter: 'blur(18px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
            border: '1px solid rgba(0,0,0,0.09)',
            boxShadow: '0 4px 12px rgba(40,48,58,0.075)',
            minHeight: 44,
            color: lcosTokens.color.text,
          }}
        >
          <Hand className="h-4 w-4" aria-hidden />
          {handOpen ? '收起手牌' : '手牌 · 卡池'}
        </button>
      </div>

      {handOpen && (
        <div
          data-lcos-workflow-hand
          className="pointer-events-auto fixed left-24 bottom-20 z-30 flex w-[min(520px,calc(100vw-160px))] flex-col rounded-2xl"
          style={{
            background: lcosTokens.color.surface,
            border: '1px solid rgba(0,0,0,0.10)',
            boxShadow: '0 12px 40px rgba(40,48,58,0.14)',
            maxHeight: 'calc(100vh - 140px)',
          }}
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ minHeight: 44, borderColor: lcosTokens.color.borderSubtle }}>
            <span className="text-sm font-semibold" style={{ color: lcosTokens.color.text }}>手牌 · Card Pool</span>
            <button type="button" aria-label="关闭手牌" onClick={() => setHandOpen(false)} className="rounded-full p-1" style={{ color: lcosTokens.color.muted }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <WorkflowCardPool projectId={projectId} />
        </div>
      )}
    </div>
  );
}