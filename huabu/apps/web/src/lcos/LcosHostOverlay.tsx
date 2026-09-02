// LcosHostOverlay — 唯一的 LCOS 画布级 overlay 容器（Phase A07）。
//
// 禁止 node Christmas tree（F-L0 §2）：任何画布浮层不再由各 renderer 自由
// 绝对定位。composer / drop-preview 等画布级浮层一律收进本容器，由
// interaction/overlayArbitration 的纯函数 visibleOverlays 裁决当前应显示哪
// 一些，并按统一 overlayLayers 分级 z-index 渲染。
//
// 仲裁输入从各 store 采集（drop 在拖拽/让步 → 只可能保留 drop-preview），
// 仲裁结果决定挂载哪些子浮层。composer 自身仍保留 hasChips / input focus 的
// 局部自决（A04 冻结行为），但拖拽这类全局高优先级状态会经仲裁把它让道。


import { visibleOverlays } from '@local-creative-os/web-gen2';
import React from 'react';

import { LcosComposerShell } from './LcosComposerShell';
import { LcosDropPreview } from './LcosDropPreview';
import { useLcosDropStore } from './lcosDropState';

const has = (kinds: readonly string[], kind: string): boolean =>
  kinds.includes(kind);

export const LcosHostOverlay: React.FC = () => {
  const dropStatus = useLcosDropStore((s) => s.state.status);

  const dropActive =
    dropStatus === 'tracking' ||
    dropStatus === 'dwell' ||
    dropStatus === 'preview';
  const dropPreview = dropStatus === 'preview';

  const visible = visibleOverlays({
    dragging: dropActive,
    resizing: false,
    selected: false,
    hovered: false,
    // 拖拽/落位时 composer 让道；其余时刻交还给 composer 自决（非 empty draft 即开）。
    composerOpen: !dropActive,
    actionArcOpen: false,
    workViewOpen: false,
    dropPreview,
    // reference-badge 是 per-node 节点级浮层，由 NodeWrapper 的 overlayContent
    // 呈现；此处画布级不重复。
    referenceBadge: false,
  });

  const showComposer = has(visible, 'composer');
  const showDrop = has(visible, 'drop-preview');

  return (
    <>
      {showComposer && <LcosComposerShell />}
      {showDrop && <LcosDropPreview />}
    </>
  );
};
