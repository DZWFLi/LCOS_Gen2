import type { ReactNode } from 'react';

import './professional-conversation.css';
import '../materials/work-density.css';

export interface ConversationIdentityViewProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly stateLabel: string;
  readonly identity?: ReactNode;
  readonly actions?: ReactNode;
  /** Owner-rendered capability/recovery messages retain their semantics and selectors. */
  readonly children?: ReactNode;
}

/** GEN1 WorkbenchFrame header/body slots, without its RunStatus interpretation or window shell. */
export function ConversationIdentityView({
  title,
  subtitle,
  stateLabel,
  identity,
  actions,
  children,
}: ConversationIdentityViewProps): React.JSX.Element {
  // Hide only an exact duplicate; capability and recovery text stays untouched.
  const visibleSubtitle = subtitle?.trim() && subtitle.trim() !== title.trim() ? subtitle : undefined;
  return (
    <section data-lcos-conversation-header className="lcos-conversation-identity">
      <div className="lcos-conversation-identity-row">
        {identity === undefined ? null : <span aria-hidden="true" className="lcos-conversation-identity-glyph">{identity}</span>}
        <div className="lcos-conversation-identity-copy">
          <h3 title={title}>{title}</h3>
          {visibleSubtitle === undefined ? null : <p>{visibleSubtitle}</p>}
        </div>
        <span data-lcos-conversation-user-state className="lcos-conversation-state-label">{stateLabel}</span>
        {actions === undefined ? null : <div className="lcos-conversation-identity-actions">{actions}</div>}
      </div>
      <div className="lcos-conversation-identity-notices">{children}</div>
    </section>
  );
}
