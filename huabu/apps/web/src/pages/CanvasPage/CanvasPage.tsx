// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Wave 1（正本 `04_逐Wave施工卡与验收.md` Wave 1 + `appendices\B_...` +
// `docs/construction/HUABU_RETIREMENT_LEDGER.md` 第 11 行）：
// `/canvas/:canvasId` **不再挂载 Huabu 三栏壳**（`MainLayout` / `CanvasHeader` /
// `CanvasLayerPanel` / `PreviewWorkspacePanel` / `CenterArea`）。本页解析 canonical
// 归属（canvasId → 项目 + 显式工作现场）后交给唯一 LCOS Shell（`LcosProjectRoute`
// → `LcosProjectShell`）。
//
// owner 收敛：画布加载/切换由 `LcosWorksiteStage` 持有，canvas SSE 订阅由
// `useLcosCanvasProps` 持有，Cmd/Ctrl+F 由 LCOS Navigator 持有。本页**只**保留
// CanvasPage 原本独有的 KEEP-KERNEL 一次性 intent 与画布注意力仲裁，避免同一
// canvasStore 出现第二个写 owner。

import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import { Loading } from '../../components/Common/Loading';
import { toast } from '../../components/Common/Toast';
import { LcosProjectRoute } from '../../lcos/app/LcosProjectRoute';
import { useLcosCanvasBinding } from '../../lcos/app/useLcosCanvasBinding';
import { useTrackCanvasAttention } from '../../store/canvasAttentionStore';
import useStore, { dismissVersionConflictToast } from '../../store/canvasStore';
import { openPreviewNode } from '../../store/previewWorkspace/actions';
import { useToolStore } from '../../store/toolStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

type NewCanvasPlacementIntent = {
  canvasId: string;
  nodeType: 'note' | 'sketch';
};

function readPreviewNodeIntent(
  state: unknown,
  routeCanvasId: string | undefined,
): string | null {
  if (!routeCanvasId || typeof state !== 'object' || state === null)
    return null;
  const intent = (state as Record<string, unknown>)['previewNode'];
  if (typeof intent !== 'object' || intent === null) return null;
  const candidate = intent as Record<string, unknown>;
  return candidate['canvasId'] === routeCanvasId &&
    typeof candidate['nodeId'] === 'string'
    ? candidate['nodeId']
    : null;
}

function readNewCanvasPlacementIntent(
  state: unknown,
  routeCanvasId: string | undefined,
): NewCanvasPlacementIntent | null {
  if (!routeCanvasId || typeof state !== 'object' || state === null) {
    return null;
  }

  const placement = (state as Record<string, unknown>)['newCanvasPlacement'];
  if (typeof placement !== 'object' || placement === null) return null;

  const candidate = placement as Record<string, unknown>;
  const nodeType = candidate['nodeType'];
  if (
    candidate['canvasId'] !== routeCanvasId ||
    (nodeType !== 'note' && nodeType !== 'sketch')
  ) {
    return null;
  }

  return { canvasId: routeCanvasId, nodeType };
}

/**
 * Page component for a single canvas.
 *
 * Wave 1 起：解析 `canvasId` 的 canonical 项目归属，并把渲染交给 LCOS Shell。
 * 本页自身不再拥有画布机械，只持有一次性 intent（新建画布后的默认工具 /
 * 指定节点预览）与画布注意力仲裁。
 */
export default function CanvasPage() {
  const { t } = useTranslation();
  const { canvasId } = useParams<{ canvasId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isLoading = useStore((s) => s.isLoading);
  const canvasNotFound = useStore((s) => s.canvasNotFound);
  const nodeCount = useStore((s) => s.nodes.length);
  // Subscribed so intent consumption can wait for the *matching* canvas to finish
  // loading instead of reading a stale/empty store.
  const storeCanvasId = useStore((s) => s.canvasId);
  const worldCanvasId = useWorkspaceStore((s) => s.worldCanvasId);
  const refreshSpaceTitles = useWorkspaceStore((s) => s.refreshSpaceTitles);
  const setPendingNodeType = useToolStore((s) => s.setPendingNodeType);
  const newCanvasPlacementRef = useRef<NewCanvasPlacementIntent | null>(null);
  const previewNodeIntentRef = useRef<string | null>(null);

  // Canvas floating chrome still steps aside while the user works in a
  // professional window / composer. Tracked at route level so the arbitration
  // survives the retirement of the old three-column shell.
  useTrackCanvasAttention();

  const binding = useLcosCanvasBinding(canvasId);

  // A create action carries a one-shot placement intent through router state.
  // Capture it before loading, then immediately remove it from browser history
  // so refresh/back navigation cannot arm Note placement again.
  useEffect(() => {
    const placement = readNewCanvasPlacementIntent(location.state, canvasId);
    const previewNodeId = readPreviewNodeIntent(location.state, canvasId);
    if (!placement && !previewNodeId) {
      if (newCanvasPlacementRef.current?.canvasId !== canvasId) {
        newCanvasPlacementRef.current = null;
      }
      return;
    }

    if (placement) newCanvasPlacementRef.current = placement;
    if (previewNodeId) previewNodeIntentRef.current = previewNodeId;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [canvasId, location, navigate]);

  useEffect(() => {
    const nodeId = previewNodeIntentRef.current;
    if (!nodeId || storeCanvasId !== canvasId || isLoading) return;
    previewNodeIntentRef.current = null;
    if (useStore.getState().nodes.some((node) => node.id === nodeId)) {
      openPreviewNode(nodeId);
    }
  }, [canvasId, isLoading, storeCanvasId]);

  useEffect(() => {
    if (!canvasId || canvasId !== worldCanvasId) return;
    void refreshSpaceTitles().catch((error) => {
      console.error('Failed to load World Portal titles:', error);
      toast(t('world.loadFailed'), { tone: 'danger' });
    });
  }, [canvasId, refreshSpaceTitles, t, worldCanvasId]);

  // Only a newly created canvas may opt into its input-appropriate creation
  // tool (Note for mouse, Sketch for pen/finger).
  // Waiting for the matching canvas to finish loading avoids treating the
  // store's transient empty array as real content, while consuming the ref
  // prevents deletion-to-empty or later rerenders from re-arming the tool.
  useEffect(() => {
    const placement = newCanvasPlacementRef.current;
    if (
      !placement ||
      placement.canvasId !== canvasId ||
      storeCanvasId !== canvasId ||
      isLoading
    ) {
      return;
    }

    // Consume on the first completed matching load even if the server ever
    // starts seeding new canvases. Otherwise deleting seeded content later
    // could incorrectly re-arm this one-shot default.
    newCanvasPlacementRef.current = null;
    if (canvasNotFound || nodeCount !== 0) return;
    setPendingNodeType(placement.nodeType);
  }, [
    canvasId,
    storeCanvasId,
    isLoading,
    canvasNotFound,
    nodeCount,
    setPendingNodeType,
  ]);

  // When the user leaves the canvas page, dismiss the persistent "modified
  // elsewhere" toast so it doesn't bleed into other routes where the stale
  // baseline isn't relevant. Pending save drains are handled by the navigation
  // blocker in `RootLayout` (which lives in the data router and never unmounts).
  useEffect(() => {
    return () => {
      dismissVersionConflictToast();
    };
  }, []);

  if (!canvasId) {
    return <Navigate to="/" replace />;
  }

  if (binding.kind === 'resolving') {
    return (
      <Loading
        variant="brand"
        layout="block"
        size="md"
        message={t('canvasPage.loading')}
      />
    );
  }

  if (binding.kind === 'resolved') {
    // 唯一 LCOS Shell 组合根；`/canvas/:id` 与 `/projects/...` 共用同一 Shell，
    // 因此 route-level Shell caller 只有一个。
    return (
      <LcosProjectRoute
        projectIdOverride={binding.projectId}
        workspaceIdOverride={binding.workspaceId}
        surfaceOverride={binding.surface}
      />
    );
  }

  const detail =
    binding.kind === 'error'
      ? `读取 Core 工作现场失败：${binding.message}`
      : '这个画布没有绑定任何 LCOS 项目工作现场。';

  return (
    <div
      data-lcos-canvas-binding={binding.kind}
      className="flex h-full flex-col items-center justify-center gap-4"
    >
      <div className="max-w-md text-center">
        <h2 className="text-fg-default text-lg font-semibold">
          此画布入口已移交 LCOS 工作空间
        </h2>
        <p className="text-fg-subtle mt-1 text-sm">{detail}</p>
      </div>
      <Link
        to="/projects"
        className="bg-inverse text-fg-inverse hover:bg-inverse/90 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('canvasPage.backToList')}
      </Link>
    </div>
  );
}