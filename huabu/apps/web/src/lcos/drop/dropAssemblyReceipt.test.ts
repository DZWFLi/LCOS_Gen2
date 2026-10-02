import { describe, expect, it } from 'vitest';
import { assemblyDropReceipt } from './dropAssemblyReceipt';
import type { AssemblyApplyItemResultV1, AssemblySourceRefV1 } from '@local-creative-os/contracts';
import type { DropAssemblyApplyIntent } from './dropTypes';
const refs: readonly AssemblySourceRefV1[] = [{ kind: 'artifactView', id: 'view-a' }, { kind: 'note', id: 'b' }, { kind: 'resource', id: 'c' }];
const intent: DropAssemblyApplyIntent = { kind: 'assembly-apply', targetId: 'canvas:one', targetRef: { kind: 'main' }, sourceRefs: refs };
const item = (index: number, status: AssemblyApplyItemResultV1['status'], channel: AssemblyApplyItemResultV1['channel']): AssemblyApplyItemResultV1 => ({ sourceRef: refs[index]!, status, channel });
const resolve = (items: AssemblyApplyItemResultV1[]) => assemblyDropReceipt(intent, 'one', { schemaVersion: 1, projectId: 'p', allApplied: true, results: items }, 'p');
describe('canonical Assembly Drop outcomes', () => {
  it('HTTP/allApplied success cannot hide mixed failure and unsupported outcomes', () => {
    const receipt = resolve([item(0, 'applied', 'presentation-membership'), item(1, 'failed', 'error'), item(2, 'skipped', 'unsupported')]);
    expect(receipt.status).toBe('partial');
    expect(receipt.retrySourceRefs).toEqual([refs[1]]);
    expect(receipt.message).toContain('1 项失败');
    expect(receipt.message).toContain('1 项不支持');
  });
  it('all failed stays failed; applied and already-member are never retry candidates', () => {
    expect(resolve(refs.map((_, index) => item(index, 'failed', 'error'))).status).toBe('failed');
    const receipt = resolve([item(0, 'applied', 'presentation-membership'), item(1, 'skipped', 'already-member'), item(2, 'failed', 'error')]);
    expect(receipt.retrySourceRefs).toEqual([refs[2]]);
  });
  it('all already-member tells the truth without a fake new change', () => {
    const receipt = resolve(refs.map((_, index) => item(index, 'skipped', 'already-member')));
    expect(receipt.status).toBe('success'); expect(receipt.message).toBe('已在目标中'); expect(receipt.retrySourceRefs).toEqual([]);
  });
  it('missing outcomes are unknown and cannot become blind replay', () => {
    const receipt = resolve([item(0, 'applied', 'presentation-membership')]);
    expect(receipt.status).toBe('partial'); expect(receipt.message).toContain('未确认'); expect(receipt.retrySourceRefs).toEqual([]);
    expect(resolve([]).status).toBe('failed');
  });
  it('does not interchange skill catalog sources/version with the same ID', () => {
    const sources = [{ kind: 'skill', id: 'same', source: 'system', version: '1' }, { kind: 'skill', id: 'same', source: 'user', version: '2' }] as const;
    const receipt = assemblyDropReceipt({ ...intent, sourceRefs: sources }, 'tx', { schemaVersion: 1, projectId: 'p', allApplied: false, results: [
      { sourceRef: sources[0], status: 'applied', channel: 'relation' }, { sourceRef: sources[1], status: 'failed', channel: 'error' },
    ] }, 'p');
    expect(receipt.retrySourceRefs).toEqual([sources[1]]);
  });
});
