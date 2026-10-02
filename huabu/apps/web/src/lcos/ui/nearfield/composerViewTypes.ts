import type { ChangeEventHandler, KeyboardEventHandler, ReactNode, Ref } from 'react';

/** Figma-only axes from 5280:669. These are NOT Core/Run state enums. */
export type ComposerVisualState =
  | 'empty' | 'editing' | 'resolving' | 'sending' | 'ready'
  | 'blocked' | 'offline' | 'permission_required' | 'degraded'
  | 'unknown' | 'error' | 'reconciling' | 'keyboard_focus';

export interface ComposerReferenceViewItem {
  readonly key: string;
  readonly label: string;
  readonly versionLabel?: string | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly thumbnailSrc?: string | undefined;
  readonly icon?: ReactNode;
  readonly unavailableReason?: string | undefined;
  /** Absent callback means no delete affordance, not a fake working action. */
  readonly onRemove?: (() => void) | undefined;
}

export interface ComposerVisualAction {
  readonly pressed?: boolean;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly onClick: () => void;
}

export interface LcosComposerViewProps {
  readonly presentation: 'nearfield' | 'inline';
  readonly state: ComposerVisualState;
  readonly targetId?: string | undefined;
  readonly title: string;
  /** The owner supplies the real receiver identity; never manufacture one from a title. */
  readonly identity?: ReactNode;
  readonly receiverAction?: ComposerVisualAction | undefined;
  readonly references: readonly ComposerReferenceViewItem[];
  readonly text: string;
  readonly textareaRef?: Ref<HTMLTextAreaElement> | undefined;
  /** Explicit reference/input surface; receiver identity is deliberately outside. */
  readonly referenceSurfaceRef?: Ref<HTMLDivElement> | undefined;
  readonly referenceDropActive?: boolean | undefined;
  readonly onSelect?: (() => void) | undefined;
  readonly onTextChange: ChangeEventHandler<HTMLTextAreaElement>;
  readonly onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  /** Business availability remains upstream-owned. */
  readonly canSubmit: boolean;
  readonly submitTitle: string;
  readonly placeholder?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly attachAction?: ComposerVisualAction | undefined;
  readonly referencePickAction?: ComposerVisualAction | undefined;
  readonly referencePicker?: ReactNode;
  /** Progressive controls reuse this Composer; never another panel or draft owner. */
  readonly continuationControls?: ReactNode;
  readonly feedback?: ReactNode;
  readonly feedbackAction?: ComposerVisualAction | undefined;
}
