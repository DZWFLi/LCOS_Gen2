import { useLayoutEffect, useState, type RefObject } from 'react';
import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';

/** Existing HUD presentation geometry only. Professional windows still come from the Stage environment. */
export function useHudObstacleRects(selector?: string, excluded?: RefObject<HTMLElement | null>): readonly ProfessionalRectV1[] {
  const [peerRects, setPeerRects] = useState<readonly ProfessionalRectV1[]>([]);
  useLayoutEffect(() => {
    if (!selector) { setPeerRects((current) => current.length ? [] : current); return; }
    // Only prior HUD peers are measured. Window geometry still comes from the Stage.
    // Callers use a one-way priority (project -> island; Dock -> camera -> tools),
    // so peers never chase one another or create a second layout owner.
    let peers: HTMLElement[] = [];
    const measure = (): void => {
      const next = peers.map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height }));
      setPeerRects((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    const synchronizePeers = (): void => {
      peers = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => element !== excluded?.current);
      resize?.disconnect(); mutation?.disconnect();
      const positioningElements = new Set<HTMLElement>();
      for (const peer of peers) {
        resize?.observe(peer);
        // The semantic HUD element can sit inside a fixed positioning wrapper
        // (for example SurfaceDock). Its size stays unchanged when that wrapper
        // moves to avoid a window, so ResizeObserver alone misses the collision.
        for (let element: HTMLElement | null = peer; element && element !== document.body; element = element.parentElement) {
          positioningElements.add(element);
        }
      }
      for (const element of positioningElements) {
        mutation?.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
      measure();
    };
    synchronizePeers();
    // Canvas controls mount after the Shell while their data is loading. Observe
    // only matching peer membership, not every node/style change in the canvas.
    const membership = typeof MutationObserver === 'undefined' ? null : new MutationObserver((records) => {
      const affectsPeer = records.some((record) => [...record.addedNodes, ...record.removedNodes].some(
        (node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null),
      ));
      if (affectsPeer) synchronizePeers();
    });
    membership?.observe(document.body, { childList: true, subtree: true });
    return () => { resize?.disconnect(); mutation?.disconnect(); membership?.disconnect(); };
  }, [selector, excluded]);
  return peerRects;
}

export const LOCATOR_HUD_OBSTACLES = '[data-lcos-shell-project-cluster],[data-lcos-nav-view],[data-lcos-family="railway"],[data-lcos-surface-dock],[data-lcos-spatial-navigator-host],[data-lcos-main-tools],[aria-label="空间导航"]';
