import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Popover } from '@/components/Common/Popover';
import { openUserHandbook } from '@/config/handbook';
import { getElectronBridge } from '@/hooks/useElectron';
import { useSettingsUiStore } from '@/store/settingsUiStore';
import { useShortcutsUiStore } from '@/store/shortcutsUiStore';

import { useLcosShellStore } from './lcosShellStore';
import { LcosProjectIdentityView } from '../ui/families/LcosProjectIdentityView';
import { LcosButton } from '../ui/primitives/LcosButton';
import '../ui/families/project-system.css';

import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';

/** Figma 5306:4057; native Popover owns placement and outside/Escape dismissal. */
export function LcosProjectSystemMenu({ name, worksiteName, target, assemblyTitle }: {
  readonly name: string; readonly worksiteName?: string; readonly target?: AssemblyTargetRefV1; readonly assemblyTitle: string;
}): React.JSX.Element {
  const desktopPlatform = getElectronBridge()?.platform;
  const showSettingsAndHandbook = desktopPlatform === undefined;
  const showShortcuts = desktopPlatform !== 'darwin';
  const resolvedWorksiteName = worksiteName?.trim() || undefined;
  const identityName = resolvedWorksiteName === undefined ? name : `${name} / ${resolvedWorksiteName}`;
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = (): void => { setPosition(null); trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!position) return;
    // The existing Popover first measures with visibility:hidden. Focus after it is placed.
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [position]);
  return <>
    <button ref={trigger} type="button" data-lcos-project-identity aria-label={`${identityName} · 项目菜单`} title={identityName}
      aria-haspopup="dialog" aria-expanded={position !== null} onClick={() => {
        if (position) { close(); return; }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setPosition({ x: rect.left, y: rect.bottom + 8 });
      }}><LcosProjectIdentityView name={name} worksiteName={resolvedWorksiteName} /></button>
    {position && <Popover position={position} onDismiss={close} className="lcos-project-system-popover">
      <div ref={panel} role="dialog" aria-label="项目菜单" className="lcos-system-panel lcos-project-system-menu">
        <header><Link to="/projects" title="返回项目列表" onClick={close}>{name}</Link><LcosButton appearance="oreo" variant="secondary" onClick={close}>关闭</LcosButton></header>
        <button type="button" className="lcos-system-row" disabled={!target} title={target ? '打开装配中的收件与来源' : '现场尚未就绪'} onClick={() => {
          if (!target) return; close(); useLcosShellStore.getState().openAssembly(target, assemblyTitle, true);
        }}><span>收件与来源</span></button>
        <button type="button" className="lcos-system-row" onClick={() => { close(); useLcosShellStore.getState().openWindow('runtime-doctor', '运行诊断'); }}>
          <span>运行诊断</span><small>连接、兼容性与恢复</small>
        </button>
        {showSettingsAndHandbook && <button type="button" className="lcos-system-row" data-lcos-project-system-action="settings"
          onClick={() => { close(); useSettingsUiStore.getState().open(); }}>
          <span>设置</span><small>应用、Agent 与连接配置</small>
        </button>}
        {showShortcuts && <button type="button" className="lcos-system-row" data-lcos-project-system-action="shortcuts"
          onClick={() => { close(); useShortcutsUiStore.getState().open(); }}>
          <span>快捷键</span><small>查看当前键鼠操作</small>
        </button>}
        {showSettingsAndHandbook && <button type="button" className="lcos-system-row" data-lcos-project-system-action="handbook"
          onClick={() => { close(); openUserHandbook(); }}>
          <span>使用手册</span><small>打开用户手册</small>
        </button>}
      </div>
    </Popover>}
  </>;
}
