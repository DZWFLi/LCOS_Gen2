// Figma P01/P02: read-only target scene; local preview zoom never moves Main.
// Reuse Huabu scene cache and viewport, not another canvas/graph runtime.
import { ApiError } from '@/api/_client';
import { SpacePreviewViewport } from '@/components/Nodes/spacePreview/SpacePreviewViewport';
import useCanvasStore from '@/store/canvasStore';
import { useSpacePreviewScene } from '@/store/spacePreviewSceneCache';

import { LcosPortalPreview, type LcosPortalPreviewState } from '../ui/families';

export interface PortalPreviewBodyProps {
  readonly projectId: string;
  readonly target?: string;
  readonly targetKind?: 'canvas';
}

export function PortalPreviewBody({ target, targetKind }: PortalPreviewBodyProps): React.JSX.Element {
  // Entity identities from Assembly are not Huabu scene addresses.
  if (!target || targetKind !== 'canvas') {
    return (
      <div className="p-4">
        <LcosPortalPreview
          state="目标缺失"
          title="入口目标预览"
          detail={target ? '此对象尚未关联可预览的工作现场。' : '此入口尚未关联目标。'}
        />
      </div>
    );
  }
  return <CanvasTargetPreview key={target} canvasId={target} />;
}

function CanvasTargetPreview({ canvasId }: { readonly canvasId: string }): React.JSX.Element {
  const hostCanvasId = useCanvasStore((s) => s.canvasId);
  const { scene, stale, error, retry } = useSpacePreviewScene(canvasId);
  const missing = error instanceof ApiError && error.status === 404;
  const matchingScene = scene?.canvasId === canvasId ? scene : null;
  const state: LcosPortalPreviewState = missing
    ? '目标缺失'
    : matchingScene
      ? stale || error ? '旧缓存'
        : matchingScene.truncated.nodes || matchingScene.truncated.edges ? '部分预览' : '可预览'
      : error ? '预览失败' : '加载中';
  const detail = missing ? '目标现场已不存在或无法访问。'
    : state === '旧缓存' ? '显示上次读取的画面，最新内容暂未确认。'
    : state === '部分预览' ? '内容较多，当前显示部分对象。'
    : state === '预览失败' ? '目标画面读取失败，可以重试。'
    : state === '可预览' ? '只读预览 · 此处缩放不会移动主画布'
    : '正在读取目标现场…';

  return (
    <div className="p-4">
      <LcosPortalPreview
        state={state}
        title={matchingScene?.title || '入口目标预览'}
        detail={detail}
        {...(error || state === '部分预览' ? { onRetry: retry } : {})}
      >
        {matchingScene && !missing && (
          <div className="h-full min-h-0 w-full overflow-hidden" data-lcos-real-portal-preview>
            <SpacePreviewViewport
              key={hostCanvasId + ':' + canvasId}
              scene={matchingScene}
              hostCanvasId={hostCanvasId}
              previewNodeId={'portal-window:' + canvasId}
              hostZoom={1}
            />
          </div>
        )}
        {!matchingScene && error && <span className="px-4 text-xs">请稍后重试。</span>}
      </LcosPortalPreview>
    </div>
  );
}
