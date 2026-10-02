import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeRetainedReader } from './readerMount';
import { ReaderVisibilityContext } from './ReaderVisibilityContext';

/** Stable portal target across tab activation, split, merge and detach.
 * React's portal target itself never changes; closing the actual Reader id
 * still unmounts the body and releases its content URLs/subscriptions.
 */
export function RetainedReaderBody({ slot, visible, onActivate, children }: {
  readonly slot?: HTMLElement;
  readonly visible: boolean;
  readonly onActivate: () => void;
  readonly children: ReactNode;
}): React.JSX.Element | null {
  const [element] = useState(() => {
    if (typeof document === 'undefined') return undefined;
    const host = document.createElement('div');
    host.className = 'lcos-retained-reader';
    return host;
  });
  useLayoutEffect(() => {
    if (element !== undefined) placeRetainedReader(element, slot, visible);
  }, [element, slot, visible]);
  useEffect(() => {
    if (element === undefined) return;
    const onPlay = (event: Event): void => {
      if (element.hidden && event.target instanceof HTMLMediaElement) event.target.pause();
    };
    element.addEventListener('play', onPlay, true);
    return () => { element.removeEventListener('play', onPlay, true); element.remove(); };
  }, [element]);
  if (element === undefined) return null;
  return createPortal(
    <ReaderVisibilityContext.Provider value={visible}>
      <div className="lcos-retained-reader-content" onPointerDownCapture={() => { if (visible) onActivate(); }} onFocusCapture={() => { if (visible) onActivate(); }}>
        {children}
      </div>
    </ReaderVisibilityContext.Provider>, element,
  );
}
