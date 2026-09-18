// LCOS Core typed client 工厂 — Wave 1 route 层唯一数据入口。
// projectId 只来自真实 Core route / URL binding；不猜 canvas title / env。

import {
  CoreProjectClient,
  CoreHealthClient,
  CoreRunClient,
  CoreConversationClient,
  CoreAssemblyClient,
  CoreRailwayClient,
  CoreCaptureSpaceClient,
  CoreResourceClient,
  CoreSkillCatalogClient,
  HttpClient,
  type CoreEnvelopeError,
} from '@local-creative-os/web-gen2';

import { readLcosHostConfig } from '../lcosHost';

export interface LcosCoreSession {
  readonly http: HttpClient;
  readonly projects: CoreProjectClient;
  readonly health: CoreHealthClient;
  readonly runs: CoreRunClient;
  readonly conversations: CoreConversationClient;
  readonly assembly: CoreAssemblyClient;
  readonly railway: CoreRailwayClient;
  /** R4 Assembly Source Bay：系统级 Capture Space 只读（capture 路）。 */
  readonly captureSpace: CoreCaptureSpaceClient;
  /** R4 Assembly Source Bay：既有 Resource 路由（sources 路）。 */
  readonly resources: CoreResourceClient;
  /** R4 Assembly Source Bay：分层 Skill catalog 只读（skills 路）。 */
  readonly skills: CoreSkillCatalogClient;
}

export interface LcosCoreSessionOptions {
  readonly coreUrl?: string;
  readonly coreToken?: string;
}

export function createLcosCoreSession(
  options: LcosCoreSessionOptions = {},
): LcosCoreSession {
  const env = readLcosHostConfig(import.meta.env as Record<string, string | undefined>);
  const http = new HttpClient({
    baseUrl: options.coreUrl ?? env.coreUrl,
    token: options.coreToken ?? env.coreToken,
  });
  return {
    http,
    projects: new CoreProjectClient(http),
    health: new CoreHealthClient(http),
    runs: new CoreRunClient(http),
    conversations: new CoreConversationClient(http),
    assembly: new CoreAssemblyClient(http),
    railway: new CoreRailwayClient(http),
    captureSpace: new CoreCaptureSpaceClient(http),
    resources: new CoreResourceClient(http),
    skills: new CoreSkillCatalogClient(http),
  };
}

export type { CoreEnvelopeError }; // re-export for honest error typing in UI layers