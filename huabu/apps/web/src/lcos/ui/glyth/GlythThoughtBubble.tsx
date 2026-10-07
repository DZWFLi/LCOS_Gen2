import { useInternalNode, useStore, useViewport } from '@xyflow/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { CanvasFloatingPopover } from '@/components/Common/CanvasFloatingPopover';
import type { GlythThought } from '../../collaboration/glythThought';
import { mountGlythThoughtView } from './glythThoughtView';
import './glyth-thought.css';

export interface GlythThoughtBubbleProps {
  readonly thought?: GlythThought;
  readonly nodeId: string;
  readonly referenceElement: RefObject<HTMLElement | null>;
  readonly body: { readonly left: number; readonly top: number; readonly size: number };
  readonly engaged?: boolean;
  readonly suppressed?: boolean;
  readonly onOpen: () => void;
}
function ThoughtContent(props: GlythThoughtBubbleProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mountGlythThoughtView> | null>(null);
  const latest = useRef(props); latest.current = props;
  useLayoutEffect(() => {
    if (!host.current) return;
    const mounted = mountGlythThoughtView(host.current, {
      onOpen: () => latest.current.onOpen(),
      onDismiss: () => latest.current.referenceElement.current?.focus({ preventScroll: true }),
    });
    view.current = mounted;
    mounted.update(latest.current);
    return () => { mounted.destroy(); view.current = null; };
  }, []);
  useLayoutEffect(() => { view.current?.update(props); });
  return <div ref={host} />;
}
/** Reuse the existing clipping-free canvas host rather than scaling text in the world-space node. */
export function GlythThoughtBubble(props: GlythThoughtBubbleProps) {
  const node = useInternalNode(props.nodeId);
  const viewport = useViewport();
  const domNode = useStore(state => state.domNode);
  if (!node || !props.thought) return null;
  const position = node.internals.positionAbsolute;
  const anchor = { x: position.x + props.body.left, y: position.y + props.body.top,
    width: props.body.size, height: props.body.size };
  const size = domNode?.getBoundingClientRect();
  const x = anchor.x * viewport.zoom + viewport.x, y = anchor.y * viewport.zoom + viewport.y;
  const inView = !size || (x + anchor.width * viewport.zoom > 0 && y + anchor.height * viewport.zoom > 0 && x < size.width && y < size.height);
  return <CanvasFloatingPopover anchor={anchor} open={inView} side="bottom-start"
    crossAxisOffset={24} offset={10} viewportPadding={18}
    nearbyControls={{ excludeNodeId: props.nodeId, maxShift: 48 }}
    referenceElement={props.referenceElement} style={{ pointerEvents: 'none' }}>
    <ThoughtContent {...props} />
  </CanvasFloatingPopover>;
}
