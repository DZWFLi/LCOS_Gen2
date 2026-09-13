// LcosSurfaceDock — 底部常驻现场切换（Figma Main/ProjectShell：SurfaceDock 底 24 常驻）。
// 三现场切换驱动真实 worksite canvasId（切换 = switchCanvas / 首次 = createCanvas + 回写）。
// Assembly 入口 Wave 5 接入，现在禁用并标注 GAP（不点后无果）。

import { Blocks } from 'lucide-react';
import { useState } from 'react';

import { LCOS_SURFACES, useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { lcosHitArea, lcosTokens } from '../ui/lcosTokens';

export interface LcosSurfaceDockProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

export function LcosSurfaceDock({
  projectId,
  canvasBySurface,
  ensureCanvas,
}: LcosSurfaceDockProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const openWindow = useLcosShellStore((s) => s.openWindow);
  const { busySurface, transitionError, switchWorksite } = useLcosWorksiteNav({
    projectId,
    canvasBySurface,
    ensureCanvas,
  });
  const [toast, setToast] = useState<string | undefined>(undefined);

  const handleSwitch = (surface: LcosSurfaceKey): void => {
    setToast(undefined);
    void switchWorksite(surface).then(() => {
      if (transitionError) setToast(transitionError);
    });
  };

  return (
    <div
      data-lcos-surface-dock
      className="pointer-events-auto fixed z-40 flex items-center gap-1 overflow-x-auto rounded-full px-2 py-1.5"
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
      {/* Navigator placeholder — Wave 4 接入搜索岛；窄屏隐藏（搜索岛本身已在顶左常驻） */}
      <div
        title="Navigator（Wave 4 接入）"
        className="mr-1 hidden items-center justify-center rounded-full sm:flex"
        style={{ width: 44, height: 44, color: lcosTokens.color.muted.light, opacity: 0.55, cursor: 'not-allowed' }}
        aria-hidden
      >
        <Blocks className="h-4 w-4" />
      </div>

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
            className="rounded-full px-3 text-sm transition-colors disabled:opacity-60 sm:px-4"
            style={{
              ...lcosHitArea,
              minHeight: 44,
              fontWeight: active ? 600 : 400,
              color: active ? lcosTokens.color.textOnInverse.light : lcosTokens.color.text.light,
              background: active ? lcosTokens.color.inverse.light : 'transparent',
            }}
          >
            {creating ? '建立中…' : label}
          </button>
        );
      })}

      <div className="mx-1 h-5 w-px" style={{ background: lcosTokens.color.borderSubtle.light }} />

      <button
        type="button"
        data-lcos-surface="assembly"
        onClick={() => openWindow('assembly', 'Assembly')}
        title="Assembly · 项目共享仓库"
        className="rounded-full px-3 text-sm transition-colors sm:px-4"
        style={{ ...lcosHitArea, minHeight: 44, color: lcosTokens.color.text.light }}
      >
        Assembly
      </button>

      {toast && (
        <div
          className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
          style={{
            background: lcosTokens.color.inverse.light,
            color: lcosTokens.color.textOnInverse.light,
            boxShadow: lcosTokens.glass.shadow,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
