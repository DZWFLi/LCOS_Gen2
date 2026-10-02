import { executionStatusLabel } from '@local-creative-os/web-gen2';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { useLcosDensity } from './useLcosDensity';
import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import './execution-node.css';

/** Figma's 66px process instrument, not a runnable Play button. The circle
 * expresses only observed state. Selection/drag/resize remain native. */
export function ExecutionMark({ status }: { status?: string }): React.JSX.Element {
  const state = status ?? 'unavailable';
  return <svg viewBox="0 0 66 66" aria-hidden="true" className="lcos-execution-mark" data-state={state}>
    <circle cx="33" cy="33" r="32.5" className="lcos-execution-ring" />
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {state === 'completed' ? <path d="m24 33 6 6 13-14" />
        : state === 'failed' ? <><path d="m26 26 14 14m0-14L26 40" /></>
        : state === 'cancelled' ? <rect x="26" y="26" width="14" height="14" rx="2" />
        : state === 'review' ? <><path d="M24 33s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" /><circle cx="33" cy="33" r="2.5" /></>
        : state === 'waiting_input' ? <><path d="M28 27a5 5 0 0 1 10 0c0 4-5 4-5 8" /><path d="M33 40h.01" /></>
        : state === 'running' ? <path className="lcos-execution-orbit" d="M33 20a13 13 0 1 1-13 13" />
        : state === 'unavailable' ? <><path d="M33 24v12M33 42h.01" /></>
        : <path d="m28 25 13 8-13 8Z" />}
    </g>
  </svg>;
}

export function ExecutionNodeBody({ nodeId }: CanvasNodeBodySlotInput): React.JSX.Element {
  const ref = useLcosReferenceStore((state) => state.nodeEntityRefs.get(nodeId));
  const density = useLcosDensity();
  const facts = ref?.descriptor;
  const execution = facts?.execution;
  const isSlot = ref?.entityType === 'result-slot';
  const status = execution?.status ?? 'unavailable';
  const runId = ref?.entityType === 'run' ? ref.entityId : execution?.runId;
  const open = (): void => {
    if (runId) useLcosShellStore.getState().openWindow('run-review', `任务 · ${facts?.title ?? '运行'}`, runId);
  };
  return <div data-lcos-species-body data-lcos-execution-node={ref?.entityId}
    data-lcos-execution-kind={isSlot ? 'result-slot' : 'run'} data-lcos-execution-state={status}
    data-lcos-density={density} className={`lcos-execution-body ${isSlot ? 'lcos-result-slot-body' : ''}`}
    tabIndex={0} aria-label={`${isSlot ? '结果位' : '任务'} · ${facts?.title ?? '状态读取中'} · ${executionStatusLabel(status)}`}
    onDoubleClick={(event) => { event.stopPropagation(); open(); }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); open(); }
    }}>
    {isSlot ? <div className="lcos-result-reservation" aria-hidden="true"><span /> <span /> <span /></div> : <ExecutionMark status={status} />}
    <span className="lcos-execution-label">{executionStatusLabel(status)}</span>
    {isSlot && density !== 'mark' && <span className="lcos-result-title">{facts?.title ?? '结果位'}</span>}
  </div>;
}
