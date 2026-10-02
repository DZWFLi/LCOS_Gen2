// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Dismiss an open overlay (popover, picker, menu) with the Escape key.
 *
 * Overlays that can only be dismissed by clicking a backdrop are
 * unreachable for keyboard users, so every backdrop-dismissible surface
 * pairs its outside-click handler with this hook. Propagation is stopped
 * so Escape dismisses the overlay without also reaching the canvas,
 * where it would clear the selection.
 */

import { useEffect, useRef } from 'react';

interface EscapeDismissEntry {
  readonly id: symbol;
  close: () => void;
}

const dismissStack: EscapeDismissEntry[] = [];
let listenerInstalled = false;

function dispatchEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  const topmost = dismissStack.at(-1);
  if (topmost === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  topmost.close();
}

function registerEscapeDismiss(entry: EscapeDismissEntry): () => void {
  dismissStack.push(entry);
  if (!listenerInstalled) {
    document.addEventListener('keydown', dispatchEscape);
    listenerInstalled = true;
  }
  return () => {
    const index = dismissStack.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) dismissStack.splice(index, 1);
    if (dismissStack.length === 0 && listenerInstalled) {
      document.removeEventListener('keydown', dispatchEscape);
      listenerInstalled = false;
    }
  };
}

export function useCloseOnEscape(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    return registerEscapeDismiss({ id: Symbol('escape-dismiss'), close: () => onCloseRef.current() });
  }, [isOpen]);
}
