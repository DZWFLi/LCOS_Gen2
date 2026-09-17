// LcosRailway — 项目具体目的地导航脊柱（Figma Railway 5385:283）。
// Railway 不承担 Main/Context/Workflow 一级切换；SurfaceDock 才是唯一一级入口。
// 这里读取 Core orderedRefs，按 kind + viewId 解析真实目的地；无法解析的 ref
// 保留为 disabled，避免用静态 roots 或“+N”占位冒充恢复能力。

import {
  CoreProjectClient,
  CoreRailwayClient,
  railwayRefKeyV1,
  reorderRailwayRefV1,
} from '@local-creative-os/web-gen2';
import { FolderOpen, Layers, ListTree, PanelsTopLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { useLcosShellStore, type LcosSurfaceKey } from './lcosShellStore';
import { lcosHudEdgeOffsets, lcosHudSafeCenterY } from './lcosHudPlacement';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosDropStore } from '../lcosDropState';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import {
  projectRailwaySnapshot,
  type RailwayUiSnapshot,
  type RailwayDestinationProjection,
} from '../navigation/railwayProjection';
import { LcosRailwayView, type LcosRailwayViewItem } from '../ui/families';

import type { DropTargetRegistration } from '../drop/dropTypes';
import type { ProjectViewRailOrderV0 } from '@local-creative-os/contracts';

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

function destinationsForOrder(
  order: ProjectViewRailOrderV0,
  previous: readonly RailwayDestinationProjection[],
): readonly RailwayDestinationProjection[] {
  const byKey = new Map(previous.map((destination) => [destination.key, destination]));
  return order.orderedRefs.flatMap((sourceRef, sourceIndex) => {
    const destination = byKey.get(railwayRefKeyV1(sourceRef));
    return destination === undefined
      ? []
      : [{ ...destination, sourceRef, sourceIndex }];
  });
}

export function LcosRailway({
  projectId,
  surfaceByWorkspace,
  activateDestination,
}: LcosRailwayProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const activeWorkspaceId = useLcosShellStore((s) => s.activeWorkspaceId);
  const windowEnvironment = useLcosShellStore((s) => s.windowEnvironment);
  const registerTarget = useLcosDropStore((s) => s.registerTarget);
  const unregisterTarget = useLcosDropStore((s) => s.unregisterTarget);
  const receiveTargetElements = useRef(new Map<string, HTMLButtonElement>());
  const [snapshot, setSnapshot] = useState<RailwayUiSnapshot | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activatingKey, setActivatingKey] = useState<string | undefined>(undefined);
  const [dragKey, setDragKey] = useState<string | undefined>(undefined);
  const [reorderTargetKey, setReorderTargetKey] = useState<string | undefined>(undefined);
  const [reordering, setReordering] = useState(false);
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
          setSnapshot(undefined);
          setError(undefined);
          return;
        }
        setSnapshot(projectRailwaySnapshot(order, {
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
        }));
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!cancelled && (cause as { name?: string }).name !== 'AbortError') {
          setSnapshot(undefined);
          setError('Railway 目的地读取失败');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, projects, railway, surfaceByWorkspace]);

  const destinations: readonly RailwayDestinationProjection[] = snapshot?.destinations ?? [];

  const publishReceiveTarget = useCallback((
    destination: RailwayDestinationProjection,
    element: HTMLButtonElement | undefined,
  ): void => {
    const targetId = `railway:${projectId}:${destination.key}`;
    if (
      element === undefined ||
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
        destinationRef: destination.sourceRef,
      },
    };
    registerTarget(target);
  }, [projectId, registerTarget, unregisterTarget]);

  // Railway is itself scrollable. A ref callback gives us the first rect, but
  // internal scroll / viewport resize can move a button without remounting it.
  // Keep the registry as live screen-space geometry just like Composer does.
  useEffect(() => {
    const publishAll = (): void => {
      for (const destination of destinations) {
        publishReceiveTarget(destination, receiveTargetElements.current.get(destination.key));
      }
    };
    publishAll();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(publishAll)
      : undefined;
    for (const destination of destinations) {
      const element = receiveTargetElements.current.get(destination.key);
      if (element !== undefined) observer?.observe(element);
    }
    window.addEventListener('resize', publishAll);
    // capture=true also observes scroll events from the Railway overflow island.
    window.addEventListener('scroll', publishAll, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publishAll);
      window.removeEventListener('scroll', publishAll, true);
      for (const destination of destinations) {
        unregisterTarget(`railway:${projectId}:${destination.key}`);
      }
    };
  }, [destinations, projectId, publishReceiveTarget, unregisterTarget]);

  const refreshAfterConflict = useCallback(async (previous: RailwayUiSnapshot): Promise<void> => {
    try {
      const [fresh, graph] = await Promise.all([
        railway.read(projectId),
        projects.getProjectGraph(projectId),
      ]);
      if (fresh === undefined || graph === undefined) {
        setSnapshot(previous);
        setError('Railway 已在别处更新，但最新顺序暂时读取失败');
        return;
      }
      setSnapshot(projectRailwaySnapshot(fresh, {
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
      }));
      setError('Railway 已在别处更新，已回读最新顺序');
    } catch {
      setSnapshot(previous);
      setError('Railway 已在别处更新，但最新顺序暂时读取失败');
    }
  }, [projectId, projects, railway, surfaceByWorkspace]);

  const reorder = useCallback((movedKey: string, targetKey: string, placement: 'before' | 'after'): void => {
    const previous = snapshot;
    if (previous === undefined) return;
    const orderedRefs = reorderRailwayRefV1(previous.order.orderedRefs, movedKey, targetKey, placement);
    if (orderedRefs === previous.order.orderedRefs) return;
    const optimisticOrder = { ...previous.order, orderedRefs };
    setSnapshot({
      order: optimisticOrder,
      destinations: destinationsForOrder(optimisticOrder, previous.destinations),
    });
    setReordering(true);
    void railway.write({ projectId, orderedRefs, expectedVersion: previous.order.version })
      .then((serverOrder) => {
        setSnapshot({
          order: serverOrder,
          destinations: destinationsForOrder(serverOrder, previous.destinations),
        });
        setError(undefined);
      })
      .catch((cause: unknown) => {
        setSnapshot(previous);
        if ((cause as { status?: number }).status === 409) {
          void refreshAfterConflict(previous);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Railway 顺序保存失败');
      })
      .finally(() => setReordering(false));
  }, [projectId, refreshAfterConflict, railway, snapshot]);

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
      disabled: !destination.available || activatingKey !== undefined || reordering,
      draggable: destination.available && !reordering,
      reorderDropTarget: reorderTargetKey === destination.key,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        if (!destination.available || reordering) return;
        setDragKey(destination.key);
        setReorderTargetKey(undefined);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/lcos-railway', destination.key);
      },
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (dragKey === undefined || dragKey === destination.key || reordering) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setReorderTargetKey(destination.key);
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const movedKey = dragKey ?? event.dataTransfer.getData('text/lcos-railway');
        if (movedKey.length === 0 || movedKey === destination.key || reordering) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        reorder(movedKey, destination.key, placement);
        setDragKey(undefined);
        setReorderTargetKey(undefined);
      },
      onDragEnd: () => {
        setDragKey(undefined);
        setReorderTargetKey(undefined);
      },
      onElement: (element) => {
        if (element === null) {
          receiveTargetElements.current.delete(destination.key);
          unregisterTarget(`railway:${projectId}:${destination.key}`);
          return;
        }
        receiveTargetElements.current.set(destination.key, element);
        publishReceiveTarget(destination, element);
      },
    }),
  );

  // An empty project has no Railway yet. Do not leave a decorative empty rail
  // on screen: the rail appears only after the user has durable destinations.
  if (items.length === 0 && error === undefined) return <></>;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const edgeOffsets = lcosHudEdgeOffsets(windowEnvironment, viewport);

  return (
    <div
      data-lcos-railway
      data-lcos-railway-version={snapshot?.order.version}
      className="pointer-events-auto fixed top-1/2 left-6 z-40 flex -translate-y-1/2 flex-col items-center gap-2"
      style={{
        left: edgeOffsets.left,
        top: lcosHudSafeCenterY(windowEnvironment, viewport.height),
      }}
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
