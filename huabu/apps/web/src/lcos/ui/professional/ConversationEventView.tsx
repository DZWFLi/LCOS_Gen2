import type { ReactNode } from 'react';

import { LcosInlinePeek } from '../primitives/LcosInlinePeek';
import { canPeekProcess, sameVisibleCopy } from './presentationText';
import './professional-conversation.css';
import '../materials/work-density.css';

export interface ConversationEventViewProps {
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Visual emphasis only; the container maps its existing canonical event kind. */
  readonly presentation: 'message' | 'activity';
  readonly tone?: 'neutral' | 'attention' | 'danger';
  readonly children?: ReactNode;
}

/** Figma A10 reading rhythm. Events remain in the owner's order, with untruncated real text. */
export function ConversationEventView({
  kind,
  title,
  body,
  label,
  icon,
  presentation,
  tone = 'neutral',
  children,
}: ConversationEventViewProps): React.JSX.Element {
  // A message's generated title may repeat its full body or truncated opening.
  // Keep all real text once; retain genuine distinct titles and activity labels.
  const repeatedTitle = presentation === 'message' && body !== undefined
    && (title.trim() === body.trim() || /(?:…|\.{3})$/.test(title.trim())
      && body.trim().startsWith(title.trim().replace(/(?:…|\.{3})$/, '')));
  const distinctBody = presentation === 'message' ? body
    : body?.trim() && !sameVisibleCopy(title, body) ? body : undefined;
  const peek = distinctBody !== undefined && canPeekProcess(kind, presentation, tone);
  return (
    <div
      data-lcos-timeline-item={kind}
      data-event-presentation={presentation}
      data-event-tone={tone}
      data-event-peek={peek || undefined}
      className="lcos-conversation-event"
    >
      <span aria-hidden="true" className="lcos-conversation-event-icon">{icon}</span>
      <div className="lcos-conversation-event-content">
        {peek ? (
          <LcosInlinePeek label={`${label}：${title}，展开过程`}
            summary={<span className="lcos-conversation-event-title">{title}</span>}>
            <div className="lcos-conversation-event-body">{distinctBody}</div>
          </LcosInlinePeek>
        ) : <>
          <span className="lcos-conversation-event-label">{label}</span>
          {!repeatedTitle && <div className="lcos-conversation-event-title">{title}</div>}
          {distinctBody === undefined ? null : <div className="lcos-conversation-event-body">{distinctBody}</div>}
        </>}
        {children}
      </div>
    </div>
  );
}
