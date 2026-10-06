import {expect,it,vi} from 'vitest';
import type {RailwaySnapshotV1} from '@local-creative-os/contracts';
import {bookmarkRailway} from './railwayBookmark';
import {DropCommitRouter} from './dropCommitRouter';
import type {DropCommitOwners,} from './dropCommitRouter';
import type {DropRailwayBookmarkIntent} from './dropTypes';
const ref={kind:'spatial' as const,projectId:'p',entityType:'collection' as const,entityId:'collection-a'};
const intent:DropRailwayBookmarkIntent={kind:'railway-bookmark',targetId:'railway-bookmark:p',projectId:'p',refs:[ref]};
const snapshot:RailwaySnapshotV1={schemaVersion:1,projectId:'p',order:{schemaVersion:1,projectId:'p',version:8,updatedAt:'',orderedRefs:[]},destinations:[],candidates:[],migrationRequired:false};
it('pins only the aggregate ref through the fresh order CAS and never duplicates it',async()=>{
  const saved={...snapshot,order:{...snapshot.order,version:9,orderedRefs:[ref]}};
  const client={snapshot:vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(saved),save:vi.fn().mockResolvedValue(saved)};
  expect(await bookmarkRailway(client,intent,()=>true)).toBe(saved);
  expect(client.save).toHaveBeenCalledExactlyOnceWith('p',[ref],8,undefined);
  await bookmarkRailway(client,intent,()=>true);expect(client.save).toHaveBeenCalledTimes(1);
});
it('stops before saving after a project change and never blindly retries a CAS failure',async()=>{
  let current=true;
  const client={snapshot:vi.fn(async()=>{current=false;return snapshot;}),save:vi.fn()};
  await expect(bookmarkRailway(client,intent,()=>current)).rejects.toThrow('项目已变化');
  expect(client.save).not.toHaveBeenCalled();
  client.snapshot.mockImplementation(async()=>snapshot);client.save.mockRejectedValue(new Error('版本冲突'));
  await expect(bookmarkRailway(client,intent,()=>true)).rejects.toThrow('版本冲突');
  expect(client.save).toHaveBeenCalledTimes(1);
});
it('does not claim success when Core did not retain the requested spatial ref',async()=>{
  const owners:DropCommitOwners={projectId:'p',bookmarkRailway:vi.fn().mockResolvedValue(snapshot),
    applyAssembly:vi.fn(),addComposerReference:vi.fn(),addCollectionMember:vi.fn()};
  const receipt=await new DropCommitRouter().commit(intent,'gesture-1',owners);
  expect(receipt.status).toBe('failed');
  expect(owners.applyAssembly).not.toHaveBeenCalled();expect(owners.addCollectionMember).not.toHaveBeenCalled();
});
