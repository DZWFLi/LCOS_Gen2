import { motion, useIsPresent } from 'motion/react';

import { Tooltip } from '@/components/Common/Tooltip';

import { satelliteVariants } from './objectOrbitMotion';
import './nearfield.css';
import {
  ACTION_ARC_HIT_INSET, ACTION_ARC_HIT_SIZE, ACTION_ARC_VISUAL_SIZE,
  type ActionArcPoint,
} from '../../navigation/actionArcGeometry';
import { useReducedSpatialMotion } from '../motion/useReducedSpatialMotion';
import { LcosIconButton } from '../primitives/LcosIconButton';

import type { ReactNode, Ref } from 'react';

export interface LcosActionOrbViewProps {
  readonly point: ActionArcPoint;
  readonly label: string;
  readonly actionId?: string | undefined;
  readonly more?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly expanded?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

/** GEN1 satellite animation + Huabu Tooltip, with exact Figma 5388:311 geometry. */
export function LcosActionOrbView({ point, label, actionId, more, disabledReason, expanded, selected, onClick, buttonRef, children }: LcosActionOrbViewProps): React.JSX.Element {
  const reduced = useReducedSpatialMotion();
  const present = useIsPresent();
  return (
    <motion.div
      className="lcos-action-orb-placement"
      custom={{ dx: -point.x, dy: -point.y }}
      variants={reduced ? {
        hidden: { opacity: 1 }, visible: { opacity: 1 }, exiting: { opacity: 0, transition: { duration: 0 } },
      } : satelliteVariants}
      style={{ position: 'absolute', left: point.x - ACTION_ARC_HIT_INSET, top: point.y - ACTION_ARC_HIT_INSET, width: ACTION_ARC_HIT_SIZE, height: ACTION_ARC_HIT_SIZE }}
    >
      <Tooltip content={present ? disabledReason ?? label : ''} wrapperClassName="lcos-action-orb-tooltip-host" contentClassName="lcos-action-orb-tooltip">
        <LcosIconButton ref={buttonRef}
          data-lcos-action-orb-hit
          data-lcos-arc-primary={more ? undefined : actionId}
          data-lcos-arc-more={more || undefined}
          data-ui-selected={selected || undefined}
          className="lcos-action-orb-hit"
          aria-label={label}
          aria-description={disabledReason}
          aria-expanded={expanded}
          aria-pressed={selected}
          disabled={disabledReason !== undefined || !present}
          tabIndex={present ? undefined : -1}
          onClick={onClick}
          style={{ position: 'relative', left: 0, top: 0, width: ACTION_ARC_HIT_SIZE, height: ACTION_ARC_HIT_SIZE }}
        >
          <span data-lcos-action-orb style={{ width: ACTION_ARC_VISUAL_SIZE, height: ACTION_ARC_VISUAL_SIZE }} className="lcos-action-orb-face" data-expanded={expanded} data-selected={selected}>{children}</span>
        </LcosIconButton>
      </Tooltip>
    </motion.div>
  );
}
