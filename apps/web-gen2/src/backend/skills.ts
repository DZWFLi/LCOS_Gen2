// R4 Assembly Source Bay（Skills 路）：分层 Skill catalog 只读 facade。
//
// 只消费既有 GET /projects/:pid/skills[/:skillId]（Core 侧复用 skill-layers.mjs 同一实现）。
// v0.15 skill 只读：Assembly 诚实呈现 apply unsupported，不复制 package、不 fake bind。

import type { SkillCatalogEntryV1, SkillCatalogReadV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreSkillCatalogClient {
  constructor(private readonly http: HttpClient) {}

  list(projectId: string, search?: string, signal?: AbortSignal): Promise<readonly SkillCatalogEntryV1[]> {
    const query = search === undefined || search.trim() === ''
      ? ''
      : `?search=${encodeURIComponent(search)}`;
    return coreRequest<readonly SkillCatalogEntryV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/skills${query}`,
      { signal },
    );
  }

  read(projectId: string, skillId: string, signal?: AbortSignal): Promise<SkillCatalogReadV1> {
    return coreRequest<SkillCatalogReadV1>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(skillId)}`,
      { signal },
    );
  }
}