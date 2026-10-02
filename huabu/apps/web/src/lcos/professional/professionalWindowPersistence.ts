import { normalizeWindowRegion, windowIdsForRegion, type WindowRegionInput, type LcosWindowRegion } from '../shell/windowRegionTopology';
import type { LcosReaderSourceV1, LcosWindow } from '../shell/lcosShellStore';
import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';

const PREFIX = 'lcos.professional-window-layout.v1.';
const BODY_KEYS = new Set(['run-review', 'assembly', 'reader', 'conversation', 'portal-preview', 'runtime-doctor', 'capture-inbox', 'connector-source', 'archive']);
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function parseWindow(value: unknown): LcosWindow | undefined {
  const raw = object(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.bodyKey !== 'string' || !BODY_KEYS.has(raw.bodyKey)
    || typeof raw.title !== 'string' || typeof raw.active !== 'boolean'
    || (raw.target !== undefined && typeof raw.target !== 'string')
    || (raw.targetKind !== undefined && raw.targetKind !== 'canvas')
    || (raw.portalWorkspaceId !== undefined && (typeof raw.portalWorkspaceId !== 'string' || !raw.portalWorkspaceId))
    || (raw.portalSourceNodeId !== undefined && (typeof raw.portalSourceNodeId !== 'string' || !raw.portalSourceNodeId))
    || (raw.readerRevisionId !== undefined && typeof raw.readerRevisionId !== 'string')
    || (raw.assemblyFollowsWorksite !== undefined && typeof raw.assemblyFollowsWorksite !== 'boolean')) return undefined;
  let assemblyTargetRef: AssemblyTargetRefV1 | undefined;
  if (raw.assemblyTargetRef !== undefined) {
    const target = object(raw.assemblyTargetRef);
    const kinds = new Set(['project', 'main', 'workspace', 'conversation', 'context', 'workflow', 'scene']);
    if (!target || typeof target.kind !== 'string' || !kinds.has(target.kind)) return undefined;
    if (target.kind === 'main') assemblyTargetRef = { kind: 'main' };
    else if (typeof target.id === 'string' && target.id.length > 0) assemblyTargetRef = { kind: target.kind as Exclude<AssemblyTargetRefV1['kind'], 'main'>, id: target.id } as AssemblyTargetRefV1;
    else return undefined;
  }
  let readerSource: LcosReaderSourceV1 | undefined;
  if (raw.readerSource !== undefined) {
    const source = object(raw.readerSource);
    if (!source || (source.surface !== 'main' && source.surface !== 'context' && source.surface !== 'workflow') || typeof source.nodeId !== 'string') return undefined;
    readerSource = { surface: source.surface, nodeId: source.nodeId };
  }
  return {
    id: raw.id, bodyKey: raw.bodyKey as LcosWindow['bodyKey'], title: raw.title,
    ...(raw.target === undefined ? {} : { target: raw.target }),
    ...(raw.targetKind === undefined ? {} : { targetKind: raw.targetKind }),
    ...(raw.portalWorkspaceId === undefined ? {} : { portalWorkspaceId:raw.portalWorkspaceId }),
    ...(raw.portalSourceNodeId === undefined ? {} : { portalSourceNodeId:raw.portalSourceNodeId }),
    ...(assemblyTargetRef === undefined ? {} : { assemblyTargetRef }),
    ...(raw.assemblyFollowsWorksite === undefined ? {} : { assemblyFollowsWorksite: raw.assemblyFollowsWorksite }),
    ...(raw.readerRevisionId === undefined ? {} : { readerRevisionId: raw.readerRevisionId }),
    ...(readerSource === undefined ? {} : { readerSource }), active: raw.active,
  };
}

function parseRegion(value: unknown): LcosWindowRegion | undefined {
  const raw = object(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id || (raw.layout !== 'floating' && raw.layout !== 'docked-right')) return undefined;
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string' && id.length > 0);
  if ('groups' in raw) {
    if (!Array.isArray(raw.groups) || raw.groups.some((value) => {
      const group = object(value);
      return !group || typeof group.id !== 'string' || !group.id || !strings(group.windowIds) || typeof group.activeWindowId !== 'string';
    })) return undefined;
    if (new Set(raw.groups.map((value) => object(value)?.id)).size !== raw.groups.length) return undefined;
  } else if (!strings(raw.windowIds) || typeof raw.activeWindowId !== 'string') return undefined;
  const input = raw as unknown as WindowRegionInput;
  const region = normalizeWindowRegion(input);
  if (region.groups.length < 1 || region.groups.length > 2 || region.groups.some((group) =>
    !group.id || group.windowIds.length < 1 || new Set(group.windowIds).size !== group.windowIds.length || !group.windowIds.includes(group.activeWindowId))) return undefined;
  if (!region.groups.some((group) => group.id === region.activeGroupId)) return undefined;
  if (region.splitDirection !== undefined && region.splitDirection !== 'horizontal' && region.splitDirection !== 'vertical') return undefined;
  if (region.groups.length === 2 && region.splitDirection === undefined) return undefined;
  if (region.splitRatio !== undefined && (!Number.isFinite(region.splitRatio) || region.splitRatio < 0.2 || region.splitRatio > 0.8)) return undefined;
  if (region.rect !== undefined && (![region.rect.x, region.rect.y, region.rect.width, region.rect.height].every(Number.isFinite) || region.rect.width <= 0 || region.rect.height <= 0)) return undefined;
  if (region.dockWidth !== undefined && (!Number.isFinite(region.dockWidth) || region.dockWidth <= 0)) return undefined;
  return region;
}

export function readProfessionalWindowLayout(projectId: string): { readonly windows: readonly LcosWindow[]; readonly windowRegions: readonly LcosWindowRegion[] } | undefined {
  try {
    const rawText = globalThis.localStorage?.getItem(`${PREFIX}${projectId}`);
    if (!rawText) return undefined;
    const raw = object(JSON.parse(rawText));
    if (raw?.version !== 1 || raw.projectId !== projectId || !Array.isArray(raw.windows) || !Array.isArray(raw.windowRegions)) return undefined;
    const windows = raw.windows.map(parseWindow); const regions = raw.windowRegions.map(parseRegion);
    if (windows.some((item) => item === undefined) || regions.some((item) => item === undefined)) return undefined;
    const validWindows = windows as LcosWindow[]; const validRegions = regions as LcosWindowRegion[];
    if (new Set(validWindows.map((item) => item.id)).size !== validWindows.length || validWindows.filter((item) => item.active).length !== (validWindows.length ? 1 : 0)) return undefined;
    if (new Set(validRegions.map((region) => region.id)).size !== validRegions.length) return undefined;
    const ids = validRegions.flatMap(windowIdsForRegion); const expected = new Set(validWindows.map((item) => item.id));
    if (ids.length !== validWindows.length || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) return undefined;
    return { windows: validWindows, windowRegions: validRegions };
  } catch { return undefined; }
}

export function writeProfessionalWindowLayout(projectId: string, windows: readonly LcosWindow[], windowRegions: readonly LcosWindowRegion[]): void {
  try { globalThis.localStorage?.setItem(`${PREFIX}${projectId}`, JSON.stringify({ version: 1, projectId, windows: windows.map(({ composerOriginKey: _detour, ...window }) => window), windowRegions })); } catch { /* optional UI continuity */ }
}

export function removeProfessionalWindowLayout(projectId: string): void {
  try { globalThis.localStorage?.removeItem(`${PREFIX}${projectId}`); } catch { /* optional UI continuity */ }
}
