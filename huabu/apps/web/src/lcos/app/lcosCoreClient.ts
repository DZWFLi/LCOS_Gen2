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
  CoreColorPinClient,
  CoreNavigationClient,
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
  /** R6 ColorPin：颜色组 canonical owner（definitions + memberships，ChangeSet-backed）。 */
  readonly colorPins: CoreColorPinClient;
  /** R6 导航目标解析（canonical NavigationMarkerService；unresolved 是合法结果）。 */
  readonly navigation: CoreNavigationClient;
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
    colorPins: new CoreColorPinClient(http),
    navigation: new CoreNavigationClient(http),
  };
}

export type { CoreEnvelopeError }; // re-export for honest error typing in UI layers