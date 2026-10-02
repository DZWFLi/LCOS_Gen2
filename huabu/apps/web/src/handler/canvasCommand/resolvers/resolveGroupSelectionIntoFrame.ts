// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { createId, type CanvasCommand, type CanvasNodeId } from '@huabu/shared';
import { frameNodes, getAbsolutePosition, type NestableNode } from '@huabu/shared/canvas-engine';

import { getSelectedNodeIds } from '../utils';

import type {
  CanvasUiIntent,
  UiIntentResolution,
  UiResolverState,
} from '../uiIntent';

export default function resolveGroupSelectionIntoFrame(
  _intent: Extract<CanvasUiIntent, { type: 'GROUP_SELECTION_INTO_FRAME' }>,
  ui: UiResolverState,
): UiIntentResolution {
  const availableIds = new Set(ui.nodes.map((node) => node.id));
  const requested = _intent.nodeIds ?? getSelectedNodeIds(ui.nodes);
  const selectedIds = [...new Set(requested)].filter((id) => availableIds.has(id));
  if (selectedIds.length !== new Set(requested).size) return { commands: [], trace: [] };
  const commands: CanvasCommand[] = [];

  if (selectedIds.length < (_intent.collectionId ? 1 : 2) && !(_intent.collectionId && _intent.emptyBounds && selectedIds.length === 0)) {
    return { commands, trace: [] };
  }

  const frameId = createId('node');
  const frameLabel = _intent.frameLabel?.trim() || 'Frame';
  const geometryById = new Map((_intent.geometryUpdates ?? []).map((item) => [item.nodeId, item]));
  const layoutNodes = ui.nodes.map((node) => {
    const update = geometryById.get(node.id as CanvasNodeId);
    return update?.position ? { ...node, position: update.position } : node;
  });
  const result = frameNodes(layoutNodes as NestableNode[], selectedIds, {
    frameId,
    label: frameLabel,
  });

  if (_intent.geometryUpdates?.length) {
    commands.push({ type: 'SET_NODE_GEOMETRY', items: [..._intent.geometryUpdates] });
  }

  const frameNode = result.nodes.find((n) => n.id === frameId) ?? (_intent.emptyBounds ? {
    id: frameId, position: { x: _intent.emptyBounds.x, y: _intent.emptyBounds.y },
    style: { width: Math.max(240, _intent.emptyBounds.width), height: Math.max(160, _intent.emptyBounds.height) },
  } : undefined);
  if (!frameNode) return { commands: [], trace: [] };
  if (frameNode) {
    commands.push({
      type: 'CREATE_NODES',
      nodes: [
        {
          id: frameId as CanvasNodeId,
          nodeType: 'frame',
          data: { label: frameLabel, origin: { type: 'user-created' }, ...(_intent.collectionId ? { lcosCollectionId: _intent.collectionId } : {}), ...(_intent.collectionNodeId ? { lcosCollectionNodeId: _intent.collectionNodeId } : {}) } as never,
          position: ('parentId' in frameNode && frameNode.parentId
            ? getAbsolutePosition(result.nodes, frameId) : frameNode.position) ?? frameNode.position,
          size: {
            width: (frameNode.style as Record<string, number>)?.width ?? 400,
            height: (frameNode.style as Record<string, number>)?.height ?? 300,
          },
        },
      ],
    });
  }

  if ('parentId' in frameNode && frameNode.parentId) commands.push({
    type: 'SET_NODE_PARENT', nodeIds: [frameId as CanvasNodeId], parentId: frameNode.parentId as CanvasNodeId,
  });

  // The native engine has already resolved selected ancestors. Reparent only
  // its direct children, not an explicitly selected child of a selected frame.
  const directChildren = result.nodes.filter((node) => node.parentId === frameId).map((node) => node.id);
  if (directChildren.length) commands.push({
    type: 'SET_NODE_PARENT',
    nodeIds: directChildren as CanvasNodeId[],
    parentId: frameId as CanvasNodeId,
  });

  commands.push({
    type: 'SET_NODE_SELECTION',
    nodeIds: [_intent.collectionNodeId ? _intent.collectionNodeId as CanvasNodeId : frameId as CanvasNodeId],
  });

  return {
    commands,
    trace: [
      {
        action: 'node_created' as const,
        nodes: [{ id: frameId, type: 'frame' as const, label: frameLabel }],
      },
    ],
  };
}
