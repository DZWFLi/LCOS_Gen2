import { Navigate } from 'react-router-dom';

import { LcosSurfaceFeedbackView } from '../lcos/ui/LcosSurfaceFeedbackView';
import { WorkspaceLoadingScreen } from '../pages/WorkspaceLoadingScreen';

import type { ReactNode } from 'react';

export interface WorkspaceGateProps {
  readonly initialising: boolean;
  readonly isSyncing: boolean;
  readonly isReady: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  /** Guarded routes send a confirmed unconfigured state to setup. */
  readonly mode?: 'guard' | 'setup';
  readonly children: ReactNode;
}

/** Route gate over the existing workspace bootstrap state; it adds no state of its own. */
export function WorkspaceGate({ initialising, isSyncing, isReady, error, onRetry,
  mode = 'guard', children }: WorkspaceGateProps): React.JSX.Element {
  if (initialising || isSyncing) return <WorkspaceLoadingScreen />;

  // A previously active workspace remains usable if an optional activation
  // attempt reports an error; only an unready guarded route needs recovery.
  if (mode === 'guard' && isReady) return <>{children}</>;

  if (error) {
    return (
      <main className="bg-bg-default flex h-full min-h-full items-center justify-center px-6">
        <div className="w-full max-w-md">
          <LcosSurfaceFeedbackView
            presentation="error"
            message="工作区服务暂时连接不上，重试后继续当前项目"
            onAction={onRetry}
            actionLabel="重试"
          />
        </div>
      </main>
    );
  }

  if (mode === 'guard') return <Navigate to="/setup" replace />;
  return <>{children}</>;
}
