// LcosCanvasCommands — 画布内命令消费者（canvas-local overlay）。
// 订阅 shell store 的 camera/locate 请求并作用于唯一 Huabu RF instance；
// 只调用 RF 相机命令（zoomIn/fitView/setViewport/focusNodesOnCanvas），
// 不建立第二 camera、不读写 node geometry truth。

import { useReactFlow, useViewport } from '@xyflow/react';
import { useEffect } from 'react';

import { focusNodesOnCanvas } from '@/components/Panels/CanvasLayerPanel/focusNodesOnCanvas';

import { useLcosShellStore } from '../shell/lcosShellStore';

export function LcosCanvasCommands(): React.JSX.Element {
  const cameraRequest = useLcosShellStore((s) => s.cameraRequest);
  const locateRequest = useLcosShellStore((s) => s.locateRequest);
  const consumeCamera = useLcosShellStore((s) => s.consumeCamera);
  const consumeLocate = useLcosShellStore((s) => s.consumeLocate);
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const rf = useReactFlow();
  const viewport = useViewport();

  useEffect(() => {
    if (!cameraRequest) return;
    switch (cameraRequest.kind) {
      case 'zoom-in':
        rf.zoomIn({ duration: 220 });
        break;
      case 'zoom-out':
        rf.zoomOut({ duration: 220 });
        break;
      case 'fit':
        void rf.fitView({ padding: 0.15, duration: 380 });
        break;
      case 'reset':
        rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 380 });
        break;
    }
    consumeCamera();
  }, [cameraRequest, rf, consumeCamera]);

  useEffect(() => {
    if (!locateRequest || locateRequest.surface !== activeSurface) return;
    // 本现场内已投影：直接 focus 唯一 camera
    if (locateRequest.nodeId) {
      focusNodesOnCanvas(rf, [locateRequest.nodeId]);
    }
    consumeLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequest?.reqId]);

  return (
    <span
      data-lcos-canvas-commands
      aria-hidden
      className="pointer-events-none absolute top-1 left-1 text-[10px] opacity-60"
      style={{ display: 'none' }}
    >
      {Math.round(viewport.zoom * 100)}%
    </span>
  );
}