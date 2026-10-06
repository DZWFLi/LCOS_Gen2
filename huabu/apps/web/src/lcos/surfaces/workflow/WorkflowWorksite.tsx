// WorkflowWorksite — Workflow 现场（Figma workflow 5388:22998）：真实卡片舞台 + 手牌/卡池仪器。
// 手牌 = 现场表征（非第二 graph）；取用 → 加入 Composer 草稿（未发送，真实动作）；
// 打开/续接（Run 执行）Wave 8 接 T6 Run 事实。

import { Hand, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';

import { WorkflowCardPool } from './WorkflowCardPool';
import { useLcosDropStore } from '../../lcosDropState';
import { useAvoidingHudPosition } from '../../navigation/useAvoidingHudPosition';
import { useHudViewport } from '../../navigation/useHudViewport';
import { LcosWorksiteStage } from '../../shell/LcosWorksiteStage';
import { WorkflowHandView } from '../../ui/workflow/WorkflowHandView';

import type { LcosSurfaceKey } from '../../shell/lcosShellStore';
import type { Workspace } from '@local-creative-os/domain';

export interface WorkflowWorksiteProps {
  readonly projectId: string;
  readonly surface: LcosSurfaceKey;
  readonly canvasId?: string;
  readonly workspaces: readonly Workspace[];
  readonly isChildWorksite?: boolean;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

export interface WorkflowHandOverlayProps {
  readonly projectId: string;
  readonly workspaces: readonly Workspace[];
  readonly sourceSurface: 'main' | 'workflow';
  readonly sourceWasChild: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * 可由 Main / Workflow 现场共同呼出的手牌；不拥有 Canvas 或业务 truth。
 * TaskCard 进入能力只委托给既有 child-worksite navigation owner。
 */
export function WorkflowHandOverlay({ projectId, workspaces, sourceSurface, sourceWasChild, open, onClose }: WorkflowHandOverlayProps): React.JSX.Element | null {
  const nativeAssemblyDropActive = useLcosDropStore((drop) => {
    const state = drop.state;
    const pending = state.status === 'tracking' || state.status === 'dwell' || state.status === 'preview';
    return pending && 'payload' in state && state.payload.kind === 'assembly';
  });
  useCloseOnEscape(open && !nativeAssemblyDropActive, onClose);
  useEffect(() => { if (open) useCanvasAttentionStore.getState().setCanvasEngaged(false); }, [open]);
  return (
    <WorkflowHandView key={projectId} open={open} onClose={onClose} nativeAssemblyDropActive={nativeAssemblyDropActive} header={<>
      <span>工作流</span>
      <button type="button" aria-label="收回手牌" onClick={onClose} className="lcos-workflow-hand-close">
        <X className="h-[22px] w-[22px]" aria-hidden />
      </button>
    </>}>
      <WorkflowCardPool projectId={projectId} workspaces={workspaces} sourceSurface={sourceSurface} sourceWasChild={sourceWasChild} onLeaveHand={onClose} />
    </WorkflowHandView>
  );
}

export function WorkflowWorksite({
  projectId,
  surface,
  canvasId,
  workspaces,
  isChildWorksite = false,
  ensureCanvas,
}: WorkflowWorksiteProps): React.JSX.Element {
  const [handOpen, setHandOpen] = useState(false);
  const viewport = useHudViewport();
  const instrument = useAvoidingHudPosition({ x: 24, y: viewport.height - 140, width: 44, height: 44 }, {},
    '[data-lcos-surface-dock],[data-lcos-spatial-navigator-host]');

  return (
    <div data-lcos-workflow-worksite data-hand-open={handOpen ? 'true' : undefined} className="relative h-full w-full">
      <LcosWorksiteStage
        projectId={projectId}
        surface={surface}
        canvasId={canvasId}
        ensureCanvas={(recreate?: boolean) => ensureCanvas(surface, recreate)}
      />

      {/* 手牌呼出（真实：卡池）；复用已有HUD几何避让，不移动画布。 */}
      <div ref={instrument.ref} data-lcos-worksite-instrument-host className="pointer-events-auto fixed z-30" style={{ left: instrument.rect.x, top: instrument.rect.y }}>
      <button
        type="button"
        data-lcos-workflow-hand-toggle
        data-open={handOpen ? 'true' : undefined}
        onClick={() => setHandOpen((v) => !v)}
        className="lcos-workflow-hand-trigger"
        style={{ position: 'relative', left: 0, bottom: 'auto' }}
        aria-label={handOpen ? '收起工作流手牌' : '打开工作流手牌'}
        title={handOpen ? '收起手牌' : '打开手牌'}
      >
        <Hand className="h-4 w-4" aria-hidden />
      </button>
      </div>

      <WorkflowHandOverlay projectId={projectId} workspaces={workspaces} sourceSurface="workflow" sourceWasChild={isChildWorksite} open={handOpen} onClose={() => setHandOpen(false)} />
    </div>
  );
}
