// CanvasHostBoundary — 唯一 Canvas 内核边界（Wave 2）。
// 职责：装配 projectId 会话 runtime（createLcosRuntime 单实例）→ host seam →
// hostExtension → `<Canvas chromeMode="lcos">`。不创建第二 ReactFlow/store/camera/history。
// 旧 chrome（NodeToolbar/Controls/MiniMap）由 chromeMode 显式隐藏，命令路径保留。

import { useLcosCanvasProps } from '@/lcos/useLcosCanvasProps';
import { Canvas } from '@/components/Panels/Canvas/Canvas';

export interface CanvasHostBoundaryProps {
  readonly projectId: string;
  readonly chromeMode?: 'huabu' | 'lcos';
}

export function CanvasHostBoundary({
  projectId,
  chromeMode = 'lcos',
}: CanvasHostBoundaryProps): React.JSX.Element {
  const { hostExtension } = useLcosCanvasProps(projectId);
  return <Canvas chromeMode={chromeMode} hostExtension={hostExtension} />;
}