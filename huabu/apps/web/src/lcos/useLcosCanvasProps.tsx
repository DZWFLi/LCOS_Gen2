// React hook that wires LCOS into a Huabu Canvas instance through the single
// `hostExtension` seam (Phase A01). The extension is built ONCE per project via
// the Gen2 HostSeam -> LcosCanvasAdapter glue, so the renderer map reference is
// stable across renders (React Flow re-initializes when `nodeTypes` identity
// changes every frame).
//
// The projection inside the effect is the spike's label-idempotent vertical:
// read the project's Core graph via Gen2Host, add artifacts as Huabu nodes
// under the external `lcos/artifact` renderer, connect Core relations as
// native Huabu edges. The binding-based canonical path (ProjectionBinding +
// RFS + reconciliation) is the Phase A10/A11 follow-up; this hook keeps the
// vertical alive end-to-end while the seam is formalized.

import { useEffect, useMemo } from 'react';

import {
  createHostSeam,
  hostExtensionFromSeam,
} from '@local-creative-os/web-gen2';

import type { CanvasHostExtension } from '@/lcos-seam/types';
import useCanvasStore from '@/store/canvasStore';

import { LcosArtifactNode } from './LcosArtifactNode';
import { createLcosHost, readLcosHostConfig } from './lcosHost';

export interface LcosCanvasProps {
  hostExtension?: CanvasHostExtension;
}

type ArtifactLike = { id?: unknown; title?: unknown; kind?: unknown };
type RelationLike = {
  id?: unknown;
  kind?: unknown;
  sourceEntityType?: unknown;
  sourceEntityId?: unknown;
  targetEntityType?: unknown;
  targetEntityId?: unknown;
};

function artifactTitle(value: ArtifactLike): string {
  return typeof value.title === 'string' && value.title.trim() !== ''
    ? value.title
    : String(value.id ?? '');
}

// A projected note's label may carry a disambiguation suffix (e.g. "Brief 1")
// that Huabu appends when several notes share a title. Normalise it away so we
// match the base artifact title and never re-add a second copy of the same card.
function noteLabelOf(node: { data?: { label?: unknown } }): string {
  const raw = typeof node.data?.label === 'string' ? node.data.label : '';
  return raw.replace(/\s+\d+$/, '').trim();
}

export function useLcosCanvasProps(projectId: string): LcosCanvasProps {
  // Stable per project: built once through the Gen2 seam adapter so the
  // renderer map reference never changes across renders (React Flow warns
  // and re-initializes when nodeTypes identity churns). connectIntent wiring
  // lands in A05; host lifecycle reuse (single host instance) in A10/A11.
  const hostExtension = useMemo(() => {
    const cfg = readLcosHostConfig(
      import.meta.env as Record<string, string | undefined>,
    );
    const rt = createLcosHost({
      ...cfg,
      canvasId: '',
      projectId: projectId || cfg.projectId,
    });
    const seam = createHostSeam(rt.host, {
      renderers: [{ nodeType: 'lcos/artifact', renderer: LcosArtifactNode }],
    });
    return hostExtensionFromSeam(seam);
  }, [projectId]);

  const canvasId = useCanvasStore((state) => state.canvasId);
  const isLoading = useCanvasStore((state) => state.isLoading);

  useEffect(() => {
    // Wait for a real canvas to be open AND fully loaded before projecting —
    // the store starts with an empty canvasId and flips to the routed id after
    // load, but `loadCanvas` sets `canvasId` *before* it hydrates `nodes`. We
    // must not read `nodes` until `isLoading` flips false, otherwise the
    // idempotency "already present" check races against an empty store and
    // re-adds a duplicate set of artifact notes.
    if (!canvasId || isLoading) return;
    const cfg = readLcosHostConfig(
      import.meta.env as Record<string, string | undefined>,
    );
    const pid = projectId || cfg.projectId;
    // Gen2Host only used to read Core graph (Domain Truth). Node/edge creation
    // goes through Huabu's native store intents (no RFS round-trip, no reload).
    const rt = createLcosHost({ ...cfg, canvasId, projectId: pid });
    (async () => {
      try {
        const graph = await rt.host.projects.getProjectGraph(pid);
        const artifacts = Array.isArray(graph?.artifacts)
          ? (graph.artifacts as ArtifactLike[])
          : [];
        const relations = Array.isArray(graph?.relations)
          ? (graph.relations as RelationLike[])
          : [];

        // 1) Project artifacts -> nodes (idempotent by label, external renderer).
        const present = new Set(
          useCanvasStore.getState().nodes.map(noteLabelOf),
        );
        const inputs = artifacts
          .filter((item) => {
            const title = artifactTitle(item);
            return title !== '' && !present.has(title);
          })
          .map((item, i) => ({
            nodeType: 'lcos/artifact' as const,
            data: { label: artifactTitle(item) },
            // Scatter the LCOS cards so they don't stack at the origin.
            placementPoint: {
              x: 80 + (i % 4) * 260,
              y: 60 + Math.floor(i / 4) * 220,
            },
          }));
        if (inputs.length > 0) {
          useCanvasStore.getState().addNodes(inputs);
        }

        // 2) Project relations -> edges. Resolve each Core relation's endpoint
        //    artifacts to their projected Huabu node ids (by label), then connect
        //    only if that edge isn't already on the canvas (idempotent).
        const store = useCanvasStore.getState();
        const nodeIdByTitle = new Map<string, string>();
        for (const node of store.nodes) {
          const title = noteLabelOf(node);
          if (title && !nodeIdByTitle.has(title))
            nodeIdByTitle.set(title, node.id);
        }
        const titleByArtifact = new Map<string, string>();
        for (const artifact of artifacts) {
          const id = String(artifact.id ?? '');
          if (id) titleByArtifact.set(id, artifactTitle(artifact));
        }

        for (const rel of relations) {
          const sourceTitle = titleByArtifact.get(
            String(rel.sourceEntityId ?? ''),
          );
          const targetTitle = titleByArtifact.get(
            String(rel.targetEntityId ?? ''),
          );
          const from = sourceTitle
            ? nodeIdByTitle.get(sourceTitle)
            : undefined;
          const to = targetTitle ? nodeIdByTitle.get(targetTitle) : undefined;
          if (!from || !to) continue;
          const already = store.edges.some(
            (edge) =>
              (edge.source === from && edge.target === to) ||
              (edge.source === to && edge.target === from),
          );
          if (already) continue;
          useCanvasStore.getState().dispatchUiIntent({
            type: 'CONNECT_EDGE',
            source: from,
            target: to,
            style: { direction: 'forward', label: String(rel.kind ?? '') },
          });
        }
      } catch (err) {
        console.warn('[lcos] load artifacts failed', err);
      }
    })();
    // Run once a canvas is open AND fully loaded (canvasId + isLoading are both
    // store-backed, so projection is guaranteed to see the hydrated canvas).
  }, [canvasId, isLoading, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { hostExtension };
}
