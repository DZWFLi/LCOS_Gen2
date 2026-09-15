// LcosRailway — 项目具体目的地导航脊柱（Figma Railway 5385:283）。
// Railway 不承担 Main/Context/Workflow 一级切换；SurfaceDock 才是唯一一级入口。
// 这里读取 Core orderedRefs，按 kind + viewId 解析真实目的地；无法解析的 ref
// 保留为 disabled，避免用静态 roots 或“+N”占位冒充恢复能力。

import {
  CoreProjectClient,
  CoreRailwayClient,
} from '@local-creative-os/web-gen2';
import { FolderOpen, Layers, ListTree, PanelsTopLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosDropStore } from '../lcosDropState';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import {
  projectRailwayDestinations,
  type RailwayDestinationProjection,
} from '../navigation/railwayProjection';
import { LcosRailwayView, type LcosRailwayViewItem } from '../ui/families';

import type { DropTargetRegistration } from '../drop/dropTypes';

export interface LcosRailwayProps {
  readonly projectId: string;
  readonly surfaceByWorkspace: ReadonlyMap<string, LcosSurfaceKey>;
  readonly activateDestination: (
    destination: RailwayDestinationProjection,
  ) => Promise<void> | void;
}

function iconFor(
  kind: RailwayDestinationProjection['kind'],
): React.ComponentType<{ className?: string }> {
  switch (kind) {
    case 'scene':
      return PanelsTopLeft;
    case 'context':
      return Layers;
    case 'workflow':
      return ListTree;
    case 'collection':
      return FolderOpen;
  }
}

export function LcosRailway({
  projectId,
  surfaceByWorkspace,
  activateDestination,
}: LcosRailwayProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const registerTarget = useLcosDropStore((s) => s.registerTarget);
  const unregisterTarget = useLcosDropStore((s) => s.unregisterTarget);
  const [destinations, setDestinations] = useState<
    readonly RailwayDestinationProjection[]
  >([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activatingKey, setActivatingKey] = useState<string | undefined>(undefined);
  const session = useMemo(() => createLcosCoreSession(), []);
  const railway = useMemo(() => new CoreRailwayClient(session.http), [session]);
  const projects = useMemo(
    () => new CoreProjectClient(session.http),
    [session],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void Promise.all([
      railway.read(projectId, controller.signal),
      projects.getProjectGraph(projectId),
    ])
      .then(([order, graph]) => {
        if (cancelled) return;
        if (!order || !graph) {
          setDestinations([]);
          setError(undefined);
          return;
        }
        setDestinations(
          projectRailwayDestinations({
            orderedRefs: order.orderedRefs,
            workspaces: graph.workspaces.map((workspace) => ({
              id: String(workspace.id),
              name: workspace.name,
              scopeId: String(workspace.scopeId),
            })),
            scopes: graph.scopes.map((scope) => ({
              id: String(scope.id),
              name: scope.name,
              kind: scope.kind,
            })),
            surfaceByWorkspace,
          }),
        );
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!cancelled && (cause as { name?: string }).name !== 'AbortError') {
          setDestinations([]);
          setError('Railway 目的地读取失败');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, projects, railway, surfaceByWorkspace]);

  const items: readonly LcosRailwayViewItem[] = destinations.map(
    (destination) => ({
      key: destination.key,
      label: destination.label,
      icon: iconFor(destination.kind),
      selected:
        destination.available &&
        (destination.workspaceId !== undefined
          ? destination.workspaceId === activeWorkspaceId
          : destination.surface === activeSurface),
      disabled: !destination.available || activatingKey !== undefined,
      onElement: (element) => {
        const targetId = `railway:${projectId}:${destination.key}`;
        if (
          element === null ||
          !destination.available ||
          destination.workspaceId === undefined
        ) {
          unregisterTarget(targetId);
          return;
        }
        const target: DropTargetRegistration = {
          targetId,
          kind: 'railway-receive',
          label: destination.label,
          rect: rectFromDomRect(element.getBoundingClientRect()),
          priority: 20,
          enabled: true,
          semantic: {
            kind: 'railway-receive',
            targetRef: { kind: 'workspace', id: destination.workspaceId },
            destinationRef: {
              kind: destination.kind,
              viewId: destination.viewId,
            },
          },
        };
        registerTarget(target);
      },
    }),
  );

  // An empty project has no Railway yet. Do not leave a decorative empty rail
  // on screen: the rail appears only after the user has durable destinations.
  if (items.length === 0 && error === undefined) return <></>;

  return (
    <div
      data-lcos-railway
      className="pointer-events-auto fixed top-1/2 left-6 z-40 flex -translate-y-1/2 flex-col items-center gap-2"
    >
      <LcosRailwayView
        items={items}
        onSelect={(key) => {
          const destination = destinations.find((item) => item.key === key);
          if (!destination?.available || activatingKey !== undefined) return;
          setActivatingKey(destination.key);
          void Promise.resolve(activateDestination(destination))
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => setActivatingKey(undefined));
        }}
        footer={error}
      />
    </div>
  );
}
