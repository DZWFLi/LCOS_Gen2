import { glythInputFromCollaborationState, resolveGlythPresentation } from '@local-creative-os/web-gen2';

import { useCollaborationSession } from '../collaboration/useCollaborationSession';
import { GlythBodyView } from '../ui/glyth/GlythBodyView';

/** Existing session projection -> existing donor renderer. This component has no business state. */
export function LcosReceiverIdentity({ projectId, conversationId, size }: {
  readonly projectId: string;
  readonly conversationId: string;
  readonly size: number;
}): React.JSX.Element | null {
  const entry = useCollaborationSession(projectId, conversationId);
  const userState = entry?.status === 'ready' && entry.projection !== undefined ? entry.projection.userState : undefined;
  const pose = resolveGlythPresentation(glythInputFromCollaborationState(userState ?? 'ready'));
  return <GlythBodyView pose={pose} userState={userState} paused={userState === undefined} size={size} left={0} top={0} />;
}
