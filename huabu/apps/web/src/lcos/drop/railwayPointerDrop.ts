import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DropPayload, SemanticDropState } from '@local-creative-os/web-gen2';

import useCanvasStore from '@/store/canvasStore';
import { useLcosDropStore } from '../lcosDropState';
import { advanceDropAtScreenPoint, acquireDrop } from '../lcosRecognizers';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { canCommitDropRelease } from './dropReleaseConsistency';
import { railwayAggregatePayload, railwayAssemblyPayload } from './railwayAssemblyDrop';

import type { RailwayDestinationV1 } from '@local-creative-os/contracts';
import type { RailwayAggregateSourceSnapshot } from './railwayAssemblyDrop';
import type { DropResolution } from './dropTypes';

type RailwayAssemblyPayload = Extract<DropPayload, { readonly kind: 'assembly' }>;
type PointerPoint = { readonly clientX: number; readonly clientY: number };
type DropSnapshot = { readonly state: SemanticDropState; readonly resolution: DropResolution | null };

export type RailwayPointerDropTrigger = 'secondary-pointer' | 'modifier-primary' | 'handle-primary';

export interface RailwayPointerDropPort {
  readonly read: () => DropSnapshot;
  readonly begin: (payload: RailwayAssemblyPayload) => boolean;
  readonly advance: (point: PointerPoint) => boolean;
  /** Start the existing store commit; the existing HostOverlay owns the write. */
  readonly commit: () => boolean;
  readonly cancel: () => void;
  readonly currentProjectId?: () => string | null;
}

export interface RailwayPointerDropController {
  /** Returns true when a supported trigger was consumed, including fail-closed starts. */
  readonly onPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    source: RailwayDestinationV1 | RailwayAggregateSourceSnapshot,
    projectId: string,
  ) => boolean;
  /** Remove listeners and cancel only this controller's uncommitted gesture. */
  readonly dispose: () => void;
}

interface PointerSession {
  readonly pointerId: number;
  readonly button: 0 | 2;
  readonly buttonMask: number;
  readonly trigger: RailwayPointerDropTrigger;
  readonly projectId: string;
  readonly payload: RailwayAssemblyPayload;
  readonly captureElement: HTMLElement;
  readonly start: PointerPoint;
  moved: boolean;
}

function pending(state: SemanticDropState): boolean {
  return state.status === 'tracking' || state.status === 'dwell' || state.status === 'preview';
}

function triggerFromPointer(event: Pick<ReactPointerEvent<HTMLElement>, 'button' | 'altKey' | 'target'>): RailwayPointerDropTrigger | null {
  if (event.button === 2) return 'secondary-pointer';
  if (event.button !== 0) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-semantic-drop-handle]')) return 'handle-primary';
  if (event.altKey) return 'modifier-primary';
  return null;
}

function defaultPort(): RailwayPointerDropPort {
  return {
    read: () => useLcosDropStore.getState(),
    begin: (payload) => {
      const before = useLcosDropStore.getState().state;
      if (before.status !== 'idle' && before.status !== 'failed') return false;
      acquireDrop(payload);
      const after = useLcosDropStore.getState().state;
      return 'payload' in after && after.payload === payload;
    },
    advance: (point) => {
      const canvas = useCanvasStore.getState();
      if (!canvas.canvasWrapper || !canvas.rfInstance) return false;
      advanceDropAtScreenPoint(point, { wrapper: canvas.canvasWrapper, instance: canvas.rfInstance });
      return true;
    },
    commit: () => {
      const transactionId = globalThis.crypto?.randomUUID?.() ?? `rail-drop-${Date.now()}`;
      useLcosDropStore.getState().commitAt(transactionId);
      const state = useLcosDropStore.getState().state;
      return state.status === 'committing' && state.transactionId === transactionId;
    },
    cancel: () => {
      const state = useLcosDropStore.getState().state;
      if (pending(state)) useLcosDropStore.getState().cancel();
    },
    currentProjectId: () => useLcosShellStore.getState().projectId,
  };
}

/**
 * Rail pointer transport for the existing Semantic Drop owner. It captures one
 * canonical aggregate payload, drives the live target resolver on move/release,
 * and delegates commit/receipt to the existing Drop store and HostOverlay.
 */
export function createRailwayPointerDropController(
  port: RailwayPointerDropPort = defaultPort(),
  eventTarget: EventTarget | undefined = typeof window === 'undefined' ? undefined : window,
  visibilityTarget: EventTarget | undefined = typeof document === 'undefined' ? undefined : document,
): RailwayPointerDropController {
  let session: PointerSession | undefined;
  let menuGuardInstalled = false;
  let menuGuardTimer: ReturnType<typeof setTimeout> | undefined;
  let clickGuard: PointerSession | undefined;
  let clickGuardTimer: ReturnType<typeof setTimeout> | undefined;
  const clearClickGuard = (): void => {
    if (clickGuardTimer !== undefined) clearTimeout(clickGuardTimer);
    clickGuardTimer = undefined;
    clickGuard = undefined;
  };
  const guardClick = (raw: Event): void => {
    const event = raw as MouseEvent;
    const active = clickGuard;
    // Keyboard activation and unrelated controls must remain usable.
    if (!active || event.detail === 0) return;
    const samePointer = 'pointerId' in event && event.pointerId === active.pointerId;
    const fromSource = event.target instanceof Node && active.captureElement.contains(event.target);
    if (!samePointer && !fromSource) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearClickGuard();
  };

  const ownsPayload = (active: PointerSession): boolean => {
    const state = port.read().state;
    return 'payload' in state && state.payload === active.payload;
  };
  const sameProject = (active: PointerSession): boolean => !port.currentProjectId
    || port.currentProjectId() === active.projectId;
  const releaseCapture = (active: PointerSession): void => {
    try {
      if (active.captureElement.hasPointerCapture(active.pointerId)) active.captureElement.releasePointerCapture(active.pointerId);
    } catch { /* capture can already be released by the browser */ }
  };
  const removeMenuGuard = (): void => {
    if (!menuGuardInstalled || !eventTarget) return;
    eventTarget.removeEventListener('contextmenu', guardContextMenu, true);
    menuGuardInstalled = false;
  };
  const guardContextMenu = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const installMenuGuard = (): void => {
    if (menuGuardInstalled || !eventTarget) return;
    menuGuardInstalled = true;
    eventTarget.addEventListener('contextmenu', guardContextMenu, true);
  };
  const clearSession = (active: PointerSession, deferMenuGuard = false): void => {
    if (session !== active) return;
    session = undefined;
    releaseCapture(active);
    if (clickGuard === active) {
      clickGuardTimer = setTimeout(clearClickGuard, 300);
    }
    if (menuGuardTimer !== undefined) clearTimeout(menuGuardTimer);
    if (deferMenuGuard && menuGuardInstalled) {
      // Chromium may dispatch contextmenu after pointerup for a right-drag.
      menuGuardTimer = setTimeout(() => { removeMenuGuard(); menuGuardTimer = undefined; }, 300);
    } else {
      removeMenuGuard();
    }
  };
  const cancel = (active = session): void => {
    if (!active || session !== active) return;
    const state = port.read().state;
    if (active.moved && ownsPayload(active) && pending(state)) port.cancel();
    clearSession(active, active.trigger === 'secondary-pointer' && active.moved);
  };
  const consume = (event: { preventDefault(): void; stopPropagation(): void }): void => { event.preventDefault(); event.stopPropagation(); };
  const onMove = (raw: Event): void => {
    const event = raw as PointerEvent;
    const active = session;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!sameProject(active) || (active.moved && !ownsPayload(active))) { cancel(active); return; }
    if (event.pointerType === 'mouse' && (event.buttons & active.buttonMask) === 0) { cancel(active); return; }
    const distance = Math.hypot(event.clientX - active.start.clientX, event.clientY - active.start.clientY);
    if (!active.moved) {
      if (distance <= 4) return;
      const state = port.read().state;
      if ((state.status !== 'idle' && state.status !== 'failed') || !port.begin(active.payload)) {
        cancel(active); return;
      }
      active.moved = true;
      // The Rail host (or document for a portalled panel) survives closing Peek/Manage.
      try { active.captureElement.setPointerCapture(active.pointerId); } catch { /* global listeners remain the fallback */ }
      if (active.trigger !== 'secondary-pointer') clickGuard = active;
    }
    consume(event);
    if (active.trigger === 'secondary-pointer') installMenuGuard();
    if (!port.advance({ clientX: event.clientX, clientY: event.clientY })) cancel(active);
  };
  const onUp = (raw: Event): void => {
    const event = raw as PointerEvent;
    const active = session;
    if (!active || event.pointerId !== active.pointerId) return;
    if (!active.moved && active.trigger === 'secondary-pointer') { cancel(active); return; }
    consume(event);
    if (event.button !== active.button || (event.buttons & active.buttonMask) !== 0
      || !active.moved || !sameProject(active) || !ownsPayload(active)) { cancel(active); return; }

    const before = port.read();
    if (before.state.status !== 'preview' || !port.advance({ clientX: event.clientX, clientY: event.clientY })) {
      cancel(active); return;
    }
    const after = port.read();
    // The release point must still resolve to the exact previewed receiver and intent.
    if (!canCommitDropRelease(before, after)) { cancel(active); return; }

    const committed = port.commit();
    clearSession(active, active.trigger === 'secondary-pointer');
    if (!committed && ownsPayload(active) && pending(port.read().state)) port.cancel();
  };
  const onCancel = (raw: Event): void => {
    const event = raw as PointerEvent;
    if (session && event.pointerId === session.pointerId) cancel(session);
  };
  const onLostCapture = (raw: Event): void => onCancel(raw);
  const onKeyDown = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    event.stopPropagation();
    cancel(session);
  };
  const onBlur = (): void => cancel(session);
  const onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') cancel(session);
  };

  const onNextPointerDown = (): void => { if (!session) clearClickGuard(); };
  eventTarget?.addEventListener('pointerdown', onNextPointerDown, true);
  eventTarget?.addEventListener('click', guardClick, true);
  eventTarget?.addEventListener('pointermove', onMove, true);
  eventTarget?.addEventListener('pointerup', onUp, true);
  eventTarget?.addEventListener('pointercancel', onCancel, true);
  eventTarget?.addEventListener('lostpointercapture', onLostCapture, true);
  eventTarget?.addEventListener('keydown', onKeyDown, true);
  eventTarget?.addEventListener('blur', onBlur);
  visibilityTarget?.addEventListener('visibilitychange', onVisibilityChange);

  return {
    onPointerDown: (event, destination, projectId) => {
      if (!session) clearClickGuard();
      const trigger = triggerFromPointer(event);
      if (!trigger) return false;
      const payload = 'ref' in destination
        ? railwayAssemblyPayload(destination, projectId)
        : railwayAggregatePayload(destination, projectId);
      if (!payload || (port.currentProjectId && port.currentProjectId() !== projectId)) {
        if (trigger !== 'secondary-pointer') consume(event);
        return trigger !== 'secondary-pointer';
      }
      event.stopPropagation();
      if (trigger !== 'secondary-pointer') event.preventDefault();
      if (session) return true;
      const state = port.read().state;
      if (state.status !== 'idle' && state.status !== 'failed') return trigger !== 'secondary-pointer';
      const active: PointerSession = {
        pointerId: event.pointerId,
        button: trigger === 'secondary-pointer' ? 2 : 0,
        buttonMask: trigger === 'secondary-pointer' ? 2 : 1,
        trigger,
        projectId,
        payload,
        captureElement: event.currentTarget.closest<HTMLElement>('[data-lcos-railway]')
          ?? event.currentTarget.ownerDocument.documentElement,
        start: { clientX: event.clientX, clientY: event.clientY },
        moved: false,
      };
      // Arm only. A click/right-click must not close the current panel or
      // expose the receive map before there is an actual drag.
      session = active;
      return true;
    },
    dispose: () => {
      cancel(session);
      eventTarget?.removeEventListener('pointerdown', onNextPointerDown, true);
      eventTarget?.removeEventListener('click', guardClick, true);
      eventTarget?.removeEventListener('pointermove', onMove, true);
      eventTarget?.removeEventListener('pointerup', onUp, true);
      eventTarget?.removeEventListener('pointercancel', onCancel, true);
      eventTarget?.removeEventListener('lostpointercapture', onLostCapture, true);
      eventTarget?.removeEventListener('keydown', onKeyDown, true);
      eventTarget?.removeEventListener('blur', onBlur);
      visibilityTarget?.removeEventListener('visibilitychange', onVisibilityChange);
      if (menuGuardTimer !== undefined) clearTimeout(menuGuardTimer);
      removeMenuGuard();
      clearClickGuard();
    },
  };
}
