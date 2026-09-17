// ProfessionalWindowStage — route-level 专业窗口舞台（Figma window 5388:27165 / Chrome 5387:331）。
// 只拥有窗口拓扑（float/title/close/active）+ body registry；body 数据来自 Core。
// 位置：canvas 右缘浮动；多窗口 tab 式切换（Wave 5 初版，dock/split Wave 9）。

import { X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import {
  deriveProfessionalWindowEnvironmentV1,
  type ProfessionalRegionLayoutV1,
} from '@local-creative-os/web-gen2';

import { ArtifactReaderBody } from './ArtifactReaderBody';
import { AssemblyBody } from './AssemblyBody';
import { ConversationWorkViewBody } from './ConversationWorkViewBody';
import { PortalPreviewBody } from './PortalPreviewBody';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosWindowChrome } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';

export interface ProfessionalWindowStageProps {
  readonly projectId: string;
}

export function ProfessionalWindowStage({ projectId }: ProfessionalWindowStageProps): React.JSX.Element {
  const windows = useLcosShellStore((s) => s.windows);
  const windowRegions = useLcosShellStore((s) => s.windowRegions);
  const activateWindow = useLcosShellStore((s) => s.activateWindow);
  const closeWindow = useLcosShellStore((s) => s.closeWindow);
  const publishWindowEnvironment = useLcosShellStore((s) => s.publishWindowEnvironment);
  const clearWindowEnvironment = useLcosShellStore((s) => s.clearWindowEnvironment);
  const composerOpen = useLcosShellStore((s) => s.composerOpen);
  const composerReceiver = useLcosShellStore((s) => s.composerTarget?.receiverConversationId);
  const active = windows.find((w) => w.active) ?? windows[windows.length - 1];
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRegion = active === undefined
    ? undefined
    : windowRegions.find((region) => region.windowIds.includes(active.id));
  const activeRegionId = activeRegion?.id ?? (active === undefined ? undefined : `region-${active.id}`);
  const regionLayout: ProfessionalRegionLayoutV1 = activeRegion?.layout ?? 'floating';
  const regionWindows = activeRegion === undefined
    ? active === undefined ? [] : [active]
    : activeRegion.windowIds
      .map((windowId) => windows.find((window) => window.id === windowId))
      .filter((window): window is NonNullable<typeof window> => window !== undefined);
  const inlineComposerOpen = composerOpen && active?.bodyKey === 'conversation'
    && active.target !== undefined && composerReceiver === active.target;
  const reading = active?.bodyKey === 'reader';
  const preferredWidth = reading ? 1120 : active?.bodyKey === 'assembly' ? 640 : 520;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (windows.length === 0 || stage === null || activeRegionId === undefined) {
      clearWindowEnvironment();
      return undefined;
    }

    const publish = (): void => {
      const rect = stage.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.right;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.bottom;
      publishWindowEnvironment(deriveProfessionalWindowEnvironmentV1({
        viewport: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
        activeRegionId,
        regions: [{
          regionId: activeRegionId,
          layout: regionLayout,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }],
      }));
    };

    publish();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
    observer?.observe(stage);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
    };
  }, [activeRegionId, clearWindowEnvironment, preferredWidth, publishWindowEnvironment, regionLayout, windows.length]);

  // Esc 栈：专业窗口是 route 内最上层可关闭面板，Esc 关掉当前窗口并阻止继续
  // 下传（否则会同时清掉画布选中）。复用 Huabu 既有 useCloseOnEscape。
  useCloseOnEscape(windows.length > 0 && !inlineComposerOpen, () => {
    if (active) closeWindow(active.id);
  });

  if (windows.length === 0) return <div data-lcos-professional-stage data-empty="true" className="hidden" aria-hidden />;

  return (
    <div
      ref={stageRef}
      data-lcos-professional-stage
      data-lcos-window-region-id={activeRegionId}
      data-lcos-window-layout={regionLayout}
      className="pointer-events-auto fixed z-40 flex flex-col rounded-2xl"
      style={{
        right: regionLayout === 'docked-right' ? 0 : 24,
        top: regionLayout === 'docked-right' ? 0 : 88,
        width: `min(${preferredWidth}px, calc(100vw - 48px))`,
        maxWidth: 'calc(100vw - 48px)',
        maxHeight: regionLayout === 'docked-right' ? '100vh' : 'calc(100vh - 140px)',
        border: '1px solid var(--lcos-window-border)',
        boxShadow: 'var(--lcos-window-shadow)',
        background: lcosTokens.color.surface,
        borderRadius: regionLayout === 'docked-right' ? 0 : 16,
        overflow: 'hidden',
      }}
    >
      {/* 顶栏 = 共享族 ProfessionalWindowChrome（Figma 5387:331；布局 浮动/停靠/分组） */}
      <LcosWindowChrome
        layout={regionWindows.length > 1 ? '分组' : regionLayout === 'docked-right' ? '停靠' : '浮动'}
        title={active?.title ?? ''}
        tabs={regionWindows.length > 1
          ? regionWindows.map((w) => ({ key: w.bodyKey, value: w.id, label: w.title, selected: w.active }))
          : undefined}
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
          <ProfessionalBody
            projectId={projectId}
            bodyKey={active.bodyKey}
            {...(active.target === undefined ? {} : { target: active.target })}
            {...(active.targetKind === undefined ? {} : { targetKind: active.targetKind })}
            {...(active.assemblyTargetRef === undefined
              ? {}
              : { assemblyTargetRef: active.assemblyTargetRef })}
          />
        )}
      </div>
    </div>
  );
}

function ProfessionalBody({
  projectId,
  bodyKey,
  target,
  targetKind,
  assemblyTargetRef,
}: {
  projectId: string;
  bodyKey: string;
  target?: string;
  targetKind?: 'canvas';
  assemblyTargetRef?: AssemblyTargetRefV1;
}): React.JSX.Element {
  switch (bodyKey) {
    case 'assembly':
      return (
        <AssemblyBody
          projectId={projectId}
          targetRef={assemblyTargetRef ?? { kind: 'main' }}
        />
      );
    case 'reader':
      return <ArtifactReaderBody projectId={projectId} artifactId={target} />;
    case 'conversation':
      return <ConversationWorkViewBody projectId={projectId} connectedConversationId={target} />;
    case 'portal-preview':
      return <PortalPreviewBody projectId={projectId} target={target} {...(targetKind ? { targetKind } : {})} />;
    case 'runtime-doctor':
    case 'capture-inbox':
    case 'connector-source':
      // 尚无生产 caller；若由旧状态恢复，只给用户可理解的不可用状态。
      return (
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <span className="text-sm" style={{ color: lcosTokens.color.muted }}>
            此工具当前不可用
          </span>
        </div>
      );
    default:
      return <></>;
  }
}

// 供 stage body 共享玻璃语言
export { lcosGlassStyle };
