// PortalNodeBody — 入口（Portal / 投影锚点）物种 body。
// 触发：双击/Enter 打开专业窗口里的 Portal 目标预览（shellStore.openWindow，
// 与 GlythNodeBody 同一 local intent 机制；单击仍是选择，selection 归 Huabu）。
// 目标身份取真实 Huabu 节点字段：canvasRef 节点的 data.targetCanvasId（见 CanvasRefNode）。
// 没有可解析目标时不假装可预览——窗口 body 会明确显示「目标缺失」。

import { useCallback, useEffect } from 'react';

import { isEditableTarget } from '@/hooks/shortcuts/isEditableTarget';
import useCanvasStore from '@/store/canvasStore';

import { LcosSpeciesBodyContent, SPECIES_ACCENT } from './LcosSpeciesBodies';
import { useLcosDensity } from './useLcosDensity';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { JSX } from 'react';

function readTarget(data: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const raw = data?.targetCanvasId ?? data?.canvasRef;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

export function PortalNodeBody(input: CanvasNodeBodySlotInput): JSX.Element {
  const density = useLcosDensity();
  const data = input.data as Readonly<Record<string, unknown>> | undefined;
  const rawTitle = data?.label ?? data?.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : '入口';
  const target = readTarget(data);

  const isOnlySelected = useCanvasStore((state) => {
    const selected = state.nodes.filter((node) => node.selected);
    return selected.length === 1 && selected[0]?.id === input.nodeId;
  });
  const openPreview = useCallback((): void => {
    useLcosShellStore.getState().openWindow('portal-preview', `入口 · ${title}`, target, 'canvas');
  }, [title, target]);

  useEffect(() => {
    if (!isOnlySelected) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const shell = useLcosShellStore.getState();
      const element = event.target instanceof Element ? event.target : null;
      if (event.key !== 'Enter' || event.defaultPrevented || isEditableTarget(event.target)
        || shell.composerOpen || shell.windows.some((window) => window.active)
        || document.querySelector('[aria-modal="true"]')
        || element?.closest('button, a, select, [role="button"], [role="menuitem"]')) return;
      event.preventDefault();
      openPreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOnlySelected, openPreview]);

  return (
    <div
      data-lcos-species-body
      data-lcos-portal-body
      data-lcos-density={density}
      onDoubleClick={(event) => {
        event.stopPropagation();
        openPreview();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          openPreview();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${title} · 双击查看入口目标`}
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        background: lcosTokens.color.surface,
        border: `1px solid ${SPECIES_ACCENT.portal}2E`,
        borderRadius: lcosTokens.radius.cardSmall,
        boxShadow: lcosTokens.shadow.default,
        padding: 10,
      }}
    >
      <LcosSpeciesBodyContent species="portal" title={title} density={density} />
      {density === 'reading' && (
        <span className="mt-1 truncate text-[10px]" style={{ color: lcosTokens.color.muted }}>
          {target ? `目标 ${target}` : '目标未绑定 · 打开后显示「目标缺失」'}
        </span>
      )}
    </div>
  );
}
