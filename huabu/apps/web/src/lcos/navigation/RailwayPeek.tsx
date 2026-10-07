// T2 C2-1C §30–37: the existing scene cache, a read-only SVG, no local camera/persistence.
import { resolveArtifactUrl } from '@/api/artifact';
import { useSpacePreviewScene } from '@/store/spacePreviewSceneCache';
import { lcosTokens } from '../ui/lcosTokens';

export function RailwayPeek({ canvasId }: { readonly canvasId: string }): React.JSX.Element {
  const { scene, loading, stale, error, retry } = useSpacePreviewScene(canvasId, true);
  if (loading && !scene) return <div role="status" data-lcos-railway-preview-status>正在读取现场预览…</div>;
  if (!scene) return <div role="status" data-lcos-railway-preview-status>预览暂不可用 <button type="button" onClick={retry}>重试</button></div>;
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  return <div data-lcos-railway-mini-scene={canvasId} className="lcos-railway-mini-scene">
    <svg role="img" aria-label={`${scene.title ?? '工作现场'} · 只读预览`} width="248" height="144"
      className="lcos-railway-mini-scene-canvas"
      viewBox={`${scene.bounds.x} ${scene.bounds.y} ${Math.max(1, scene.bounds.width)} ${Math.max(1, scene.bounds.height)}`} preserveAspectRatio="xMidYMid meet">
      {scene.edges.map((edge) => { const source = byId.get(edge.source), target = byId.get(edge.target); if (!source || !target) return null;
        return <line key={edge.id} x1={source.x + source.width / 2} y1={source.y + source.height / 2}
          x2={target.x + target.width / 2} y2={target.y + target.height / 2} stroke={lcosTokens.color.muted} strokeOpacity=".4" vectorEffect="non-scaling-stroke" />;
      })}
      {scene.nodes.map((node) => <g key={node.id} data-lcos-preview-node={node.id}>
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={node.kind === 'frame' ? 4 : 10}
          fill={node.kind === 'frame' ? 'none' : 'white'} fillOpacity=".9" stroke={lcosTokens.color.muted} strokeOpacity=".4"
          strokeDasharray={node.kind === 'nested-preview' ? '3 2' : undefined} vectorEffect="non-scaling-stroke" />
        {node.imageSrc ? <image href={resolveArtifactUrl(node.imageSrc, scene.canvasId)} x={node.x} y={node.y}
          width={node.width} height={node.height} preserveAspectRatio="xMidYMid meet" /> :
          (node.previewText || node.label) ? <foreignObject x={node.x + 6} y={node.y + 6} width={Math.max(1, node.width - 12)} height={Math.max(1, node.height - 12)}>
            <div className="lcos-railway-mini-scene-copy" style={{ fontSize: Math.min(14, Math.max(8, node.height / 4)) }}>
              {node.previewText ?? node.label}
            </div>
          </foreignObject> : null}
      </g>)}
    </svg>
    {scene.nodes.length === 0 && <span role="status" data-lcos-railway-preview-empty>这个现场暂时为空</span>}
    {(stale || error || scene.truncated.nodes || scene.truncated.edges) && <div role="status" data-lcos-railway-preview-status>
      {error ? <>预览更新失败 <button type="button" onClick={retry}>重试</button></> : stale ? '正在更新预览…' : '场景较大，显示部分内容'}
    </div>}
  </div>;
}
