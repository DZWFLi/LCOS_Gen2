// LCOS host runtime — builds the LCOS boundary (Gen2Host) from env config and
// exposes the seam (extraRenderers / overlays / connectIntent) for the Huabu
// Canvas. Kept React-free so it can be reused by the host page and tests.

import {
  HttpClient,
  HuabuRfsClient,
  Gen2Host,
  createHostSeam,
  type HostSeam,
} from '@local-creative-os/web-gen2';

export interface LcosHostConfig {
  coreUrl: string;
  coreToken: string;
  /** RFS base. Empty string = same origin (the web app proxies /api -> Huabu backend). */
  rfsUrl: string;
  rfsToken: string;
  canvasId: string;
  projectId: string;
}

export interface LcosHostRuntime {
  host: Gen2Host;
  seam: HostSeam;
}

export function readLcosHostConfig(env: Record<string, string | undefined>): LcosHostConfig {
  return {
    // Same-origin `/lcos-core` (proxied by the web dev server to Local Core) so the
    // browser never makes a cross-origin call to the Core and triggers CORS.
    coreUrl: env.LCOS_CORE_URL ?? '/lcos-core',
    coreToken: env.LCOS_CORE_TOKEN ?? 'dev-token',
    rfsUrl: env.LCOS_RFS_URL ?? '',
    rfsToken: env.HUABU_CONNECTION_TOKEN ?? 'dev-token',
    canvasId: env.LCOS_CANVAS ?? '',
    projectId: env.PROJECT_ID ?? 'disposable-mvp-sample',
  };
}

export function createLcosHost(config: LcosHostConfig): LcosHostRuntime {
  const http = new HttpClient({ baseUrl: config.coreUrl, token: config.coreToken });
  const rfs = new HuabuRfsClient({
    canvasId: config.canvasId,
    baseUrl: config.rfsUrl,
    bearerToken: config.rfsToken,
  });
  const host = new Gen2Host({ http, rfs, projectId: config.projectId });
  return { host, seam: createHostSeam(host) };
}
