// useLcosCanvasProps — 生产 composition root 的 React 挂载点（Phase A 审计重做）。
//
// 审计结论（LCOS_Gen2_PhaseA_GitHub最新提交重新审计_20260903 §10）：
//   旧实现为 seam 建一个 host、effect 里又建一个 host、无 dispose、用 label
//   去重/反查、注释把正式 Binding 留给 follow-up —— 全部修掉。
//
// 新结构：
//   - 一个 project session 一个 `createLcosRuntime()`（A10 composition root），
//     画布就绪后通过 runtime.retarget({canvasId}) 重定向，不重建 seam。
//   - projection 全部走正式 `ProjectToSpaceProjection`（RFS + ProjectionBinding），
//     由 host.reconcile('project-open') 驱动；本 hook 不再 getProjectGraph→addNodes、
//     不再按 label 反查 relation（审计 P0-2）。
//   - 卸载时 runtime.dispose() 清 reconciler timer（审计 P0-1）。
//
// hostExtension 只构建一次（renderers/overlays/recognizers 引用稳定），connectIntent
// 经 seam 的 host provider 读取当前 host —— retarget 后仍指向同一 runtime 的新 host。
// 渲染层 = canvas-local overlay + recognizers + connect intent + binding-aware
// node body seam（Wave 3）；产品整机 UI 全部走 route-level Shell，不在这里叠。


import {
  createHostSeam,
  hostExtensionFromSeam,
  type HostSeam,
  type LcosHostRuntime,
} from '@local-creative-os/web-gen2';
import { useEffect, useRef, useState } from 'react';

import useCanvasStore from '@/store/canvasStore';

import { LcosCameraMotionPolicy } from './host/LcosCameraMotionPolicy';
import { useLcosHostStore } from './host/lcosHostState';
import { createLcosRuntime, readLcosHostConfig } from './lcosHost';
import { LcosHostOverlay } from './LcosHostOverlay';
import { createLcosRecognizers } from './lcosRecognizers';
import { useLcosReferenceStore } from './lcosReferenceState';
import { LcosActionArc } from './navigation/LcosActionArc';
import { LcosCameraControls } from './navigation/LcosCameraControls';
import { LcosCanvasCommands } from './navigation/LcosCanvasCommands';
import { createLcosNodePresentationSeam } from './nodes/createLcosNodePresentationSeam';
import { installReferenceClickSuppressor } from './referenceClickSuppressor';

import type { CanvasHostExtension } from '@/lcos-seam/types';

export interface LcosCanvasProps {
  hostExtension?: CanvasHostExtension;
}

export function useLcosCanvasProps(projectId: string): LcosCanvasProps {
  const runtimeRef = useRef<LcosHostRuntime | null>(null);
  const suppressorDisposeRef = useRef<(() => void) | null>(null);
  const [hostExtension, setHostExtension] = useState<CanvasHostExtension | undefined>(undefined);

  const canvasId = useCanvasStore((state) => state.canvasId);
  const isLoading = useCanvasStore((state) => state.isLoading);

  // 1) 会话级 runtime 一次创建；projectId 变化时重建（dispose 旧的），re-render 不重建。
  useEffect(() => {
    const current = runtimeRef.current;
    if (current && current.projectId === projectId) return;
    current?.dispose();
    runtimeRef.current = null;

    const cfg = readLcosHostConfig(
      import.meta.env as Record<string, string | undefined>,
    );
    const rt = createLcosRuntime({ ...cfg, projectId });
    runtimeRef.current = rt;
    // 当前会话 host 透传：overlay/控制器读取 store，retarget 后不冻结在初始 host。
    useLcosHostStore.getState().setHost(rt.host);
    // click suppressor 归 runtime 生命周期（审计 §4.4）——安装一次，卸载时 dispose。
    suppressorDisposeRef.current?.();
    suppressorDisposeRef.current = installReferenceClickSuppressor();
    // seam 的 connect provider 指向同一个 runtime 对象（host getter 恒取当前 host）。
    const seam: HostSeam = createHostSeam(() => rt.host, {
      overlays: [
        { key: 'lcos/host-overlay', node: <LcosHostOverlay /> },
        // Wave 4：canvas-local 相机/命令（唯一 Huabu camera，非第二视图）
        { key: 'lcos/canvas-commands', node: <LcosCanvasCommands /> },
        { key: 'lcos/camera-controls', node: <LcosCameraControls /> },
        // R2：节点命令菜单（T3 Action Arc）—— 画布内唯一节点命令入口
        { key: 'lcos/action-arc', node: <LcosActionArc /> },
        // Wave 9：相机移动期间暂停呼吸动画/投影（只写 DOM 属性，不重渲染）
        { key: 'lcos/camera-motion', node: <LcosCameraMotionPolicy /> },
      ],
      recognizers: createLcosRecognizers().map((recognizer) => ({ recognizer })),
      // Wave 3：binding-aware 全节点 presentation seam（原生 body 仅 fallback）。
      resolveNodeBody: createLcosNodePresentationSeam(),
    });
    // hostExtensionFromSeam returns the mirrored (web-gen2) shape; the Huabu
    // consumer re-declares the same structural type, so an explicit cast is
    // the honest boundary — both are plain data, no runtime conversion.
    setHostExtension(hostExtensionFromSeam(seam) as CanvasHostExtension);
  }, [projectId]);

  // 2) 卸载时必须清 reconciler timer（审计 P0-1）。
  useEffect(() => {
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
      useLcosHostStore.getState().setHost(null);
      suppressorDisposeRef.current?.();
      suppressorDisposeRef.current = null;
    };
  }, []);

  // 3) 画布就绪后：retarget 到真实 canvas + 正式 reconcile（project-open）。
  //    不在 render 中触发（A11 规则 1）。
  useEffect(() => {
    if (!canvasId || isLoading) return;
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.retarget({ canvasId });
    useLcosHostStore.getState().setHost(rt.host);
    void (async () => {
      try {
        await rt.host.reconcile('project-open');
        // P0-5: identity cache derives from ProjectionBinding — reconcile just
        // established/refreshed the bindings, so re-sync the reference index.
        const bindings = await rt.host.listNodeBindings();
        useLcosReferenceStore.getState().resetNodeEntities();
        for (const binding of bindings) {
          useLcosReferenceStore.getState().registerNodeEntity(
            binding.spatialId,
            {
              entityType: binding.entityType,
              entityId: binding.entityId,
              // R2：把从 Core 快照派生的呈现描述（真实 kind/可用性/revision）一起登记，
              // 供单一 junction 决定物种与次级行；没有描述就如实不带。
              ...(binding.descriptor ? { descriptor: binding.descriptor } : {}),
            },
          );
        }
        // dev-only：绑定登记的完成信号（R2 e2e 用它作为"节点身份已就绪"的确定性等待点，
        // 避免在 store 尚未填充时对命令可用性做假失败判定）。
        if (import.meta.env.DEV) {
          console.info(`[lcos] bindings registered: ${bindings.length}`);
        }
      } catch (error) {
        console.warn('[lcos] project-open reconcile failed', error);
      }
    })();
  }, [canvasId, isLoading, projectId]);

  return { hostExtension };
}
