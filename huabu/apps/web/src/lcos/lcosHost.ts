// LCOS host runtime — builds the LCOS boundary (Gen2Host) from env config and
// exposes the seam (extraRenderers / overlays / connectIntent) for the Huabu
// Canvas. Kept React-free so it can be reused by the host page and tests.
//
// Audit (2026-09-03 §10): the production path must own exactly ONE
// Gen2HostRuntime per project session and derive the seam from it, so the
// host extension identity stays stable across canvas retargets and no second
// host is ever created inside a React effect.

import {
  HttpClient,
  HuabuRfsClient,
  Gen2Host,
  createHostSeam,
  createLcosHostRuntime,
  type HostSeam,
  type LcosEndpointConfig,
  type LcosHostRuntime as Gen2SessionRuntime,
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

export function readLcosHostConfig(
  env: Record<string, string | undefined>,
): LcosHostConfig {
  return {
    coreUrl: env.LCOS_CORE_URL ?? '/lcos-core',
    coreToken: env.LCOS_CORE_TOKEN ?? 'dev-token',
    rfsUrl: env.LCOS_RFS_URL ?? '',
    rfsToken: env.HUABU_CONNECTION_TOKEN ?? 'dev-token',
    canvasId: env.LCOS_CANVAS ?? '',
    projectId: env.PROJECT_ID ?? 'disposable-mvp-sample',
  };
}

export function createLcosHost(config: LcosHostConfig): LcosHostRuntime {
  const http = new HttpClient({
    baseUrl: config.coreUrl,
    token: config.coreToken,
  });
  const rfs = new HuabuRfsClient({
    canvasId: config.canvasId,
    baseUrl: config.rfsUrl,
    bearerToken: config.rfsToken,
  });
  const host = new Gen2Host({ http, rfs, projectId: config.projectId });
  return { host, seam: createHostSeam(host) };
}

function endpointOf(config: LcosHostConfig): LcosEndpointConfig {
  return {
    coreUrl: config.coreUrl,
    coreToken: config.coreToken,
    rfsBaseUrl: config.rfsUrl,
    rfsToken: config.rfsToken,
    canvasId: config.canvasId,
  };
}

/**
 * Production host composition root (audit P0-1 / A10): ONE session runtime per
 * project. `retarget({projectId?, canvasId?})` re-binds inside the same session
 * WITHOUT rebuilding a seam; dispose clears the reconciler timer. The seam is
 * built from the runtime's host PROVIDER, so it keeps reading the current host
 * after a retarget — no second host, no stale client.
 */
export function createLcosRuntime(
  config: LcosHostConfig,
): Gen2SessionRuntime {
  return createLcosHostRuntime(
    {
      build: (endpoint, projectId) =>
        createLcosHost({ ...config, ...endpoint, projectId }).host,
    },
    endpointOf(config),
    config.projectId,
  );
}


