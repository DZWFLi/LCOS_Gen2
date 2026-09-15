// LcosSurfaceDock — 底部常驻现场切换（Figma Main/ProjectShell：SurfaceDock 底 24 常驻）。
// 三现场切换驱动真实 worksite canvasId（切换 = switchCanvas / 首次 = createCanvas + 回写）。
// Assembly 有独立入口；Dock 只呈现三个一级 Surface。

import { GitBranch, Network, PanelsTopLeft } from 'lucide-react';

import {
  LCOS_SURFACES,
  useLcosShellStore,
  type LcosSurfaceKey,
} from './lcosShellStore';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { lcosTokens } from '../ui/lcosTokens';

export interface LcosSurfaceDockProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (
    surface: LcosSurfaceKey,
    force?: boolean,
  ) => Promise<string | undefined>;
}

function surfaceIcon(surface: LcosSurfaceKey): React.JSX.Element {
  switch (surface) {
    case 'main':
      return <PanelsTopLeft className="h-[18px] w-[18px]" aria-hidden />;
    case 'context':
      return <Network className="h-[18px] w-[18px]" aria-hidden />;
    case 'workflow':
      return <GitBranch className="h-[18px] w-[18px]" aria-hidden />;
  }
}

export function LcosSurfaceDock({
  projectId,
  canvasBySurface,
  ensureCanvas,
}: LcosSurfaceDockProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const { busySurface, transitionError, switchWorksite } = useLcosWorksiteNav({
    projectId,
    canvasBySurface,
    ensureCanvas,
  });
  const handleSwitch = (surface: LcosSurfaceKey): void => {
    void switchWorksite(surface);
  };

  return (
    <div
      data-lcos-surface-dock
      className="pointer-events-auto fixed z-40 rounded-full px-2 py-1.5"
      style={{
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        maxWidth: 'calc(100vw - 24px)',
        background: 'rgba(252,252,252,0.86)',
        backdropFilter: 'blur(18px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
        border: '1px solid rgba(0,0,0,0.09)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
      }}
    >
      <div className="flex items-center gap-1 overflow-x-auto">
      {LCOS_SURFACES.map(({ key, label }) => {
        const active = activeSurface === key;
        const creating = busySurface === key;
        return (
          <button
            key={key}
            type="button"
            disabled={creating}
            data-lcos-surface={key}
            data-lcos-surface-active={active ? 'true' : 'false'}
            onClick={() => handleSwitch(key)}
            title={`${label} · ${canvasBySurface[key] !== undefined ? '现场画布' : '首次进入会建立现场画布'}`}
            aria-label={label}
            aria-pressed={active}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors disabled:opacity-60"
            style={{
              minHeight: 44,
              minWidth: 44,
              color: active ? lcosTokens.color.text : lcosTokens.color.muted,
              background: active ? lcosTokens.color.raised : 'transparent',
            }}
          >
            {creating ? (
              <span
                className="h-4 w-4 animate-pulse rounded-full"
                style={{ background: lcosTokens.color.muted }}
                aria-hidden
              />
            ) : (
              surfaceIcon(key)
            )}
          </button>
        );
      })}
      </div>

      {transitionError && (
        <div
          role="alert"
          className="absolute bottom-full left-1/2 mb-3 w-max -translate-x-1/2 rounded-2xl px-3 py-1.5 text-xs"
          style={{
            maxWidth: 'min(400px, calc(100vw - 32px))',
            background: lcosTokens.color.inverse,
            color: lcosTokens.color.textOnInverse,
            boxShadow: lcosTokens.glass.shadow,
          }}
        >
          {transitionError}
        </div>
      )}
    </div>
  );
}
