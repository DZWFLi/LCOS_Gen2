// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// 只拥有窗口拓扑（float/title/close/active）+ body registry；body 数据来自 Core。
// 位置：canvas 右缘浮动；多窗口 tab 式切换（Wave 5 初版，dock/split Wave 9）。

import { X } from 'lucide-react';

import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

export interface ProfessionalWindowStageProps {
  readonly projectId: string;
}

export function ProfessionalWindowStage({ projectId }: ProfessionalWindowStageProps): React.JSX.Element {
  const windows = useLcosShellStore((s) => s.windows);
  const activateWindow = useLcosShellStore((s) => s.activateWindow);
  const closeWindow = useLcosShellStore((s) => s.closeWindow);
  const active = windows.find((w) => w.active) ?? windows[windows.length - 1];

  if (windows.length === 0) return <div data-lcos-professional-stage data-empty="true" className="hidden" aria-hidden />;

  return (
    <div
      data-lcos-professional-stage
      className="pointer-events-auto fixed z-40 flex flex-col rounded-2xl"
      style={{
        right: 24,
        top: 88,
        width: 'min(520px, calc(100vw - 48px))',
        maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'calc(100vh - 140px)',
        border: '1px solid rgba(0,0,0,0.10)',
        boxShadow: '0 12px 40px rgba(40,48,58,0.14)',
        background: lcosTokens.color.surface.light,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* 顶栏（Chrome 5387:331：title + close；多窗口 tab） */}
      <div
        className="flex items-center gap-1 border-b px-3"
        style={{ minHeight: 48, borderColor: lcosTokens.color.borderSubtle.light }}
      >
        {windows.map((w) => (
          <button
            key={w.id}
            type="button"
            data-lcos-window-tab={w.bodyKey}
            data-lcos-window-active={w.active ? 'true' : 'false'}
            onClick={() => activateWindow(w.id)}
            className="max-w-[180px] truncate rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              color: w.active ? lcosTokens.color.text.light : lcosTokens.color.muted.light,
              background: w.active ? lcosTokens.color.raised.light : 'transparent',
            }}
          >
            {w.title}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="关闭窗口"
          onClick={() => active && closeWindow(active.id)}
          className="rounded-full p-1.5"
          style={{ color: lcosTokens.color.muted.light }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* body */}
      <div className="min-h-[240px] flex-1 overflow-y-auto" style={{ background: lcosTokens.color.canvas.light }}>
        {active && (
          <ProfessionalBody projectId={projectId} bodyKey={active.bodyKey} target={active.target} />
        )}
      </div>
    </div>
  );
}

function ProfessionalBody({
  projectId,
  bodyKey,
  target,
}: {
  projectId: string;
  bodyKey: string;
  target?: string;
}): React.JSX.Element {
  switch (bodyKey) {
    case 'assembly':
      return <AssemblyBody projectId={projectId} />;
    case 'reader':
      return <ArtifactReaderBody projectId={projectId} artifactId={target} />;
    case 'conversation':
    case 'runtime-doctor':
    case 'capture-inbox':
    case 'connector-source':
      // Wave 8 / 5 收尾接入；当前诚实展示
      return (
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <span className="text-sm" style={{ color: lcosTokens.color.muted.light }}>
            {bodyKey} body（Wave 8 接入）
          </span>
        </div>
      );
    default:
      return <></>;
  }
}

// 供 stage body 共享玻璃语言
export { lcosGlassStyle };