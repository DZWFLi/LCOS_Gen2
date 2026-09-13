// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// 只拥有窗口拓扑（float/title/close/active）+ body registry；body 数据来自 Core。
// 位置：canvas 右缘浮动；多窗口 tab 式切换（Wave 5 初版，dock/split Wave 9）。

import { X } from 'lucide-react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { ConversationWorkViewBody } from './ConversationWorkViewBody';
import { PortalPreviewBody } from './PortalPreviewBody';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosWindowChrome } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

export interface ProfessionalWindowStageProps {
  readonly projectId: string;
}

export function ProfessionalWindowStage({ projectId }: ProfessionalWindowStageProps): React.JSX.Element {
  const windows = useLcosShellStore((s) => s.windows);
  const activateWindow = useLcosShellStore((s) => s.activateWindow);
  const closeWindow = useLcosShellStore((s) => s.closeWindow);
  const active = windows.find((w) => w.active) ?? windows[windows.length - 1];

  // Esc 栈：专业窗口是 route 内最上层可关闭面板，Esc 关掉当前窗口并阻止继续
  // 下传（否则会同时清掉画布选中）。复用 Huabu 既有 useCloseOnEscape。
  useCloseOnEscape(windows.length > 0, () => {
    if (active) closeWindow(active.id);
  });

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
        border: '1px solid var(--lcos-window-border)',
        boxShadow: 'var(--lcos-window-shadow)',
        background: lcosTokens.color.surface,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* 顶栏 = 共享族 ProfessionalWindowChrome（Figma 5387:331；布局 浮动/停靠/分组） */}
      <LcosWindowChrome
        layout="浮动"
        title={active?.title ?? ''}
        tabs={windows.map((w) => ({ key: w.bodyKey, value: w.id, label: w.title, selected: w.active }))}
        onSelectTab={(id) => activateWindow(id)}
        actions={
          <button
            type="button"
            data-lcos-window-icon-button
            aria-label="关闭窗口"
            onClick={() => active && closeWindow(active.id)}
          >
            <X className="h-4 w-4" />
          </button>
        }
      />

      {/* body */}
      <div className="min-h-[240px] flex-1 overflow-y-auto" style={{ background: lcosTokens.color.canvas }}>
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
      return <ConversationWorkViewBody projectId={projectId} connectedConversationId={target} />;
    case 'portal-preview':
      return <PortalPreviewBody projectId={projectId} target={target} />;
    case 'runtime-doctor':
    case 'capture-inbox':
    case 'connector-source':
      // 未接入 body：诚实展示，不假装可用
      return (
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <span className="text-sm" style={{ color: lcosTokens.color.muted }}>
            {bodyKey}（尚未接入）
          </span>
        </div>
      );
    default:
      return <></>;
  }
}

// 供 stage body 共享玻璃语言
export { lcosGlassStyle };