import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTemporalPreviewStore } from './temporalPreviewState';
import {
  createTemporalLocateRequest,
  projectTemporalGroupTargets,
  temporalPartialReason,
} from './temporalTargetProjection';
import {
  projectTemporalGroupWindow,
  shiftTemporalWindowStart,
  temporalGroupRatio,
} from './temporalWindow';
import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import { useLcosShellStore } from '../../shell/lcosShellStore';
import { temporalLengthPresentation } from '../../ui/context/temporalLength';
import { TemporalRailView, type TemporalRailItemView } from '../../ui/context/TemporalRailView';

import type { TemporalIndexV1 } from '@local-creative-os/contracts';

export interface TemporalRailProps {
  readonly projectId: string;
  readonly workspaceId?: string;
  readonly canvasId?: string;
}

export function TemporalRail({ projectId, workspaceId, canvasId }: TemporalRailProps): React.JSX.Element | null {
  const [index, setIndex] = useState<TemporalIndexV1 | null>(null);
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [reason, setReason] = useState<string>();
  const [activationReason, setActivationReason] = useState<string>();
  const [windowStart, setWindowStart] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const nodeEntityRefs = useLcosReferenceStore((referenceState) => referenceState.nodeEntityRefs);
  const bindingCanvasId = useLcosReferenceStore((referenceState) => referenceState.bindingCanvasId);
  const previewOwnerKey = `${projectId}:${workspaceId ?? 'none'}:${canvasId ?? 'none'}`;

  useEffect(() => {
    setActivationReason(undefined);
    return () => useTemporalPreviewStore.getState().clear(previewOwnerKey);
  }, [previewOwnerKey]);

  useEffect(() => {
    if (workspaceId === undefined) {
      setIndex(null);
      setState('empty');
      setReason('请选择 Context 子现场');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    setIndex(null);
    setWindowStart(0);
    setReason(undefined);
    setActivationReason(undefined);
    const session = createLcosCoreSession();
    void session.temporal.getIndex(projectId, workspaceId, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setIndex(response.value);
      setState(response.value.facts.length > 0 ? 'ready' : 'empty');
      setReason(response.value.facts.length > 0 ? undefined : '这个 Context 还没有可定位的时间记录');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setIndex(null);
      setState('error');
      setReason(error instanceof Error ? error.message : '时间记录读取失败');
    });
    return () => controller.abort();
  }, [projectId, workspaceId, attempt]);

  const allGroups = useMemo(() => index?.mid ?? [], [index]);
  const window = useMemo(
    () => projectTemporalGroupWindow(allGroups, windowStart),
    [allGroups, windowStart],
  );
  const groups = window.groups;
  const projections = useMemo(
    () => {
      // Bindings belong to the existing canvas owner. During recovery, an old
      // canvas map must never be sent as a locate request to the new canvas.
      const currentBindings = canvasId !== undefined && bindingCanvasId === canvasId ? nodeEntityRefs : new Map();
      return new Map(groups.map((group) => [group.id, projectTemporalGroupTargets(group, currentBindings)]));
    },
    [groups, nodeEntityRefs, canvasId, bindingCanvasId],
  );
  const items = useMemo<readonly TemporalRailItemView[]>(() => groups.map((group) => {
    const projection = projections.get(group.id);
    const located = projection?.projectedTargetCount ?? 0;
    const targetSummary = `可定位 ${located}/${group.targets.length} 个目标`;
    const length = temporalLengthPresentation({ eventCount: group.eventCount, targetCount: group.targets.length });
    return {
      id: group.id,
      label: `${new Date(group.start).toLocaleString()} · ${group.eventCount} 条记录 · ${targetSummary}`,
      ratio: temporalGroupRatio(group, groups),
      lengthTier: length.tier,
      staticWidth: length.width,
      disabled: projection === undefined || projection.nodeIds.length === 0,
    };
  }), [groups, projections]);

  const windowView = useMemo(() => {
    const first = groups[0];
    const last = groups.at(-1);
    if (first === undefined || last === undefined) return undefined;
    return {
      startIndex: window.startIndex,
      endIndex: window.endIndex,
      totalCount: window.totalCount,
      positionRatio: window.positionRatio,
      spanRatio: window.spanRatio,
      label: `${new Date(first.start).toLocaleString()} — ${new Date(last.end).toLocaleString()}`,
    };
  }, [groups, window]);

  const activate = (item: TemporalRailItemView): void => {
    const group = groups.find((candidate) => candidate.id === item.id);
    if (group === undefined) return;
    const projection = projections.get(group.id);
    if (projection === undefined || projection.nodeIds.length === 0) return;
    setActivationReason(temporalPartialReason(projection, group.targets.length));
    const request = createTemporalLocateRequest({
      reqId: `temporal-${Date.now()}`,
      ...(canvasId === undefined ? {} : { canvasId }),
      projection,
    });
    if (request !== undefined) useLcosShellStore.getState().requestLocate(request);
  };

  const preview = useCallback((item: TemporalRailItemView | null): void => {
    const store = useTemporalPreviewStore.getState();
    if (item === null || canvasId === undefined) {
      store.clear(previewOwnerKey);
      return;
    }
    const projection = projections.get(item.id);
    if (projection === undefined || projection.nodeIds.length === 0) {
      store.clear(previewOwnerKey);
      return;
    }
    store.preview({ ownerKey: previewOwnerKey, canvasId, nodeIds: projection.nodeIds });
  }, [canvasId, previewOwnerKey, projections]);

  const unavailableReason = state === 'ready' && items.length > 0 && items.every((item) => item.disabled)
    ? canvasId === undefined ? '当前子现场尚无可定位的画布'
      : bindingCanvasId !== canvasId ? '当前现场的对象绑定尚未就绪'
        : `${items.length} 组时间记录的目标尚未投影到当前现场`
    : undefined;

  if (state === 'empty') return null;

  return <TemporalRailView
    items={items}
    window={windowView}
    reason={unavailableReason ?? activationReason ?? reason}
    state={activationReason === undefined ? state : 'recovery'}
    scopeKey={`${previewOwnerKey}:${window.startIndex}`}
    onRetry={() => setAttempt((value) => value + 1)}
    onActivate={activate}
    onPreviewChange={preview}
    onWindowShift={(direction) => {
      setActivationReason(undefined);
      setWindowStart((current) => shiftTemporalWindowStart({
        currentStart: current,
        direction,
        totalCount: allGroups.length,
      }));
    }}
  />;
}
