// Minimal LCOS Artifact node renderer — the Phase A01/A02 external-renderer
// proof. Registered into the Huabu Canvas seam under the `lcos/artifact` key
// via the host extension (see useLcosCanvasProps).
//
// A02: wraps in Huabu's NodeWrapper (resize/selection/fill/toolbar slots all
// reused) and consumes the NodeWrapper presentation context to resolve the
// shared adaptive density (mark / summary / working / reading) — the first
// real consumer of the presentation protocol. Full species morphology is
// Phase B.

import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { BaseNodeData } from '@huabu/shared';

import { resolvePresentationDensity } from '@local-creative-os/web-gen2';

import { NodeWrapper } from '@/components/Nodes/NodeWrapper';
import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';

const ACCENT = '#2e90ff';

export const LcosArtifactNode: React.FC<NodeProps> = ({
  id,
  data,
  selected,
}) => {
  const label =
    typeof (data as { label?: unknown } | undefined)?.label === 'string'
      ? ((data as { label?: string }).label as string)
      : id;

  const presentation = useLcosNodePresentation();
  const density = presentation
    ? resolvePresentationDensity({
        worldWidth: presentation.worldWidth,
        worldHeight: presentation.worldHeight,
        zoom: presentation.zoom,
        dpr: presentation.dpr,
        screenWidth: presentation.screenWidth,
        screenHeight: presentation.screenHeight,
        phase: presentation.phase,
      })
    : 'working'; // no adaptive data (e.g. preview outside the canvas)

  let body: React.ReactNode;
  if (density === 'mark') {
    // Identity dot only — the honest level for a tiny node.
    body = (
      <div
        data-lcos-density={density}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: ACCENT,
            opacity: presentation?.phase === 'selected' ? 1 : 0.75,
          }}
        />
      </div>
    );
  } else if (density === 'summary') {
    // One line of identity.
    body = (
      <div
        data-lcos-density={density}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#1e40af',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {label}
        </span>
      </div>
    );
  } else if (density === 'working') {
    // Identity + kind line.
    body = (
      <div
        data-lcos-density={density}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflow: 'hidden',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#5b7bb8' }}>LCOS · artifact</div>
      </div>
    );
  } else {
    // reading: the full card.
    body = (
      <div
        data-lcos-density={density}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>
          LCOS · {label}
        </div>
      </div>
    );
  }

  return (
    <NodeWrapper
      id={id}
      data={data as BaseNodeData}
      type={'lcos/artifact'}
      selected={selected}
      resizable
      keepAspectRatio={false}
      className="transition-all duration-200"
    >
      <div data-lcos-node={id}>{body}</div>
    </NodeWrapper>
  );
};
