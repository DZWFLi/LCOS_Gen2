// LCOS integration of the project's existing Floating UI dependency.
// Uses @floating-ui/react's documented FloatingTree/useDismiss/FocusManager
// composition. No custom outside-click listener or parallel overlay registry.
import {
  autoUpdate, flip, offset, shift, FloatingFocusManager, FloatingNode,
  FloatingPortal, FloatingTree, useClick, useDismiss, useFloating,
  useFloatingNodeId, useFloatingParentNodeId, useInteractions, useRole,
} from '@floating-ui/react';
import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { FLOATING_CHROME_PROPS } from './floatingChrome';

export interface ToolbarPopoverProps {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly triggerClassName?: string;
  readonly className?: string;
  readonly placement?: 'top' | 'bottom-end' | 'top-start';
  readonly triggerData?: Readonly<Record<`data-${string}`, string | boolean>>;
}

function ToolbarPopoverInner({ label, trigger, children, open, onOpenChange,
  triggerClassName, className, placement = 'top', triggerData }: ToolbarPopoverProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };
  const nodeId = useFloatingNodeId();
  const { refs, context, floatingStyles, isPositioned } = useFloating({
    nodeId, open: isOpen, onOpenChange: setOpen, placement,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, {
    bubbles: { escapeKey: false, outsidePress: true },
    // A second context-menu request targets the existing toolbar, not a close.
    outsidePress: (event) => event.button !== 2,
  });
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  return <>
    <Button ref={refs.setReference} variant="ghost" iconOnly size="sm"
      {...triggerData} {...getReferenceProps({ 'aria-label': label })}
      className={cn('text-fg-muted hover:bg-bg-default', triggerClassName)}>
      {trigger}
    </Button>
    <FloatingNode id={nodeId}>
      {isOpen && <FloatingPortal>
        <FloatingFocusManager context={context} modal={false} restoreFocus
          closeOnFocusOut={false} returnFocus>
          <div ref={refs.setFloating} {...FLOATING_CHROME_PROPS}
            {...getFloatingProps({ 'aria-label': label })}
            className={cn('border-edge-default shadow-bottom bg-surface rounded-lg border p-1.5', className)}
            style={{ ...floatingStyles, zIndex: 1001, visibility: isPositioned ? 'visible' : 'hidden' }}>
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>
        </FloatingFocusManager>
      </FloatingPortal>}
    </FloatingNode>
  </>;
}

/** The root creates the documented tree; nested pickers inherit that tree. */
export function ToolbarPopover(props: ToolbarPopoverProps) {
  const parentId = useFloatingParentNodeId();
  return parentId === null
    ? <FloatingTree><ToolbarPopoverInner {...props} /></FloatingTree>
    : <ToolbarPopoverInner {...props} />;
}
