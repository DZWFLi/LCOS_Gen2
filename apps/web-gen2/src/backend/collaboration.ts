// Collaboration facade V0.
//
// This is intentionally a thin, behavior-preserving client seam. It does not
// own Conversation, Run, Continuation, provider-session, or recovery truth.
// Those remain with their existing Core owners. The purpose is to stop UI
// callers from assembling multiple backend clients themselves while we test
// whether the collaboration-facing surface can stay small.
//
// V0 only exposes `delegate()` as a product-level action because canonical Run
// dispatch already exists. Do NOT add `collaborate()` until a real prompt/send
// owner exists (Huabu prompt transport is currently unsupported).

import { CoreContinuationClient } from './continuation.js';
import { CoreConversationClient } from './conversations.js';
import { HttpClient } from './client.js';
import { CoreRunClient } from './runs.js';

import type { CreateRunInputV1 } from './runs.js';

export class CoreCollaborationClient {
  readonly conversations: CoreConversationClient;
  readonly runs: CoreRunClient;
  readonly continuations: CoreContinuationClient;

  constructor(http: HttpClient) {
    this.conversations = new CoreConversationClient(http);
    this.runs = new CoreRunClient(http);
    this.continuations = new CoreContinuationClient(http);
  }

  /**
   * Delegate work to the canonical Run path.
   *
   * V0 deliberately preserves the existing Core contract:
   * POST /projects/:pid/runs. This facade does not invent another task truth.
   */
  delegate(
    projectId: string,
    input: CreateRunInputV1,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.runs.createRun(projectId, input, signal);
  }
}
