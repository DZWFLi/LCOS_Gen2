// GlythNodeBody — Conversation/Glyth 物种 body（Figma Glyth 语义；T7-A01 donor 机制）。
// 双击（无 binding 不响应）打开同一 Conversation 的 Professional Work View；
// 单击仍是选择（selection 归 Huabu，body 不抢）。打开是 local UI intent（shellStore.openWindow），
// 不创建第二 conversation/session truth。

import { useViewport } from '@xyflow/react';


import { useLcosReferenceStore } from '../lcosReferenceState';
import { LcosSpeciesBodyContent, SPECIES_ACCENT } from './LcosSpeciesBodies';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { JSX } from 'react';

export function GlythNodeBody(input: CanvasNodeBodySlotInput): JSX.Element {
  const { zoom } = useViewport();
  const data = input.data as Readonly<Record<string, unknown>> | undefined;
  const raw = data?.label ?? data?.title;
  const title = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '未命名';
  const density: 'mark' | 'summary' | 'working' | 'reading' =
    zoom < 0.25 ? 'mark' : zoom < 0.55 ? 'summary' : zoom < 0.9 ? 'working' : 'reading';

  const openWorkView = (): void => {
    const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId);
    if (!ref || ref.entityType !== 'conversation') return; // 无 binding 不响应
    useLcosShellStore.getState().openWindow('conversation', `工作台 · ${title}`, ref.entityId);
  };

  return (
    <div
      data-lcos-species-body
      data-lcos-glyth-body
      onDoubleClick={(event) => {
        event.stopPropagation();
        openWorkView();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          openWorkView();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${title} · 双击打开会话工作台`}
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        background: lcosTokens.color.surface.light,
        border: `1px solid ${SPECIES_ACCENT.glyth}2E`,
        borderRadius: lcosTokens.radius.cardSmall,
        boxShadow: lcosTokens.shadow.default,
        padding: 10,
      }}
    >
      <LcosSpeciesBodyContent species="glyth" title={title} density={density} />
    </div>
  );
}