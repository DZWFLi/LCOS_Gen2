import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';

import { LightCurtainBackdrop, LightCurtainDismissPlane } from '../spatial/LightCurtainBackdrop';
import { PRESENTATION_EXIT } from '../spatial/presentationMotion';
import { useLayerReturnFocus } from '../spatial/useLayerReturnFocus';

import './workflow-hand.css';
import type { ReactNode } from 'react';

export interface WorkflowHandViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly nativeAssemblyDropActive?: boolean;
}

function HandLayer({ header, children, onClose, nativeAssemblyDropActive = false }: Omit<WorkflowHandViewProps, 'open'>): React.JSX.Element {
  const present = useIsPresent();
  const reduced = Boolean(useReducedMotion());
  const layer = useLayerReturnFocus(present);
  return (
    <motion.div
      ref={layer}
      data-lcos-workflow-hand
      data-presentation-present={present ? 'true' : 'false'}
      className="lcos-workflow-hand-stage"
      data-native-assembly-drop={nativeAssemblyDropActive ? 'true' : undefined}
      role="region"
      aria-label="工作流手牌"
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced ? { duration: 0 } : PRESENTATION_EXIT}
    >
      <LightCurtainBackdrop kind="hand" />
      <LightCurtainDismissPlane label="收回工作流手牌" disabled={!present || nativeAssemblyDropActive} onClose={onClose} />
      <div className="lcos-workflow-hand-shell">
        <div className="lcos-workflow-hand-head">{header}</div>
        {children}
      </div>
    </motion.div>
  );
}

/** GEN1 ObjectOrbit presence pattern: boundary survives the open=false render. */
export function WorkflowHandView({ open, header, children, onClose, nativeAssemblyDropActive = false }: WorkflowHandViewProps): React.JSX.Element {
  return (
    <AnimatePresence initial={false} mode="sync">
      {open ? <HandLayer key="workflow-hand" header={header} onClose={onClose} nativeAssemblyDropActive={nativeAssemblyDropActive}>{children}</HandLayer> : null}
    </AnimatePresence>
  );
}
