// LcosCameraMotionPolicy — 相机移动期间暂停复杂视觉（Wave 9 性能收口）。
//
// 挂为 canvas-local overlay（与相机同处 ReactFlow 子树）。相机在动时给
// `[data-lcos-project-shell]` 打 `data-lcos-camera-moving`，由 lcos.css 关掉
// 呼吸动画与节点投影——整屏 transform 时这两个是主要开销来源。
//
// 只写 DOM 属性、不 setState：每帧 React 重渲染本身比被省下的动画更贵。
// 停止判定用短去抖（相机落定即恢复），不受 reduced-motion 影响（CSS 已各自覆盖）。

import { useViewport } from '@xyflow/react';
import { useEffect, useRef } from 'react';

/** 相机停止后多久算落定（略大于一帧，避免抖动闪烁）。 */
const CAMERA_SETTLE_MS = 140;

const MOVING_ATTR = 'data-lcos-camera-moving';

export function LcosCameraMotionPolicy(): null {
  const { x, y, zoom } = useViewport();
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    // 首帧只是挂载，不是相机移动。
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const shell = document.querySelector('[data-lcos-project-shell]');
    if (!shell) return;
    shell.setAttribute(MOVING_ATTR, 'true');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      document.querySelector('[data-lcos-project-shell]')?.removeAttribute(MOVING_ATTR);
    }, CAMERA_SETTLE_MS);
  }, [x, y, zoom]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      document.querySelector('[data-lcos-project-shell]')?.removeAttribute(MOVING_ATTR);
    },
    [],
  );

  return null;
}
