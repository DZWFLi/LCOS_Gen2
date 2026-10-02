// Preserve the original conflict-unlock invariant with behavior, not a regex
// tied to retired V0 function names. The Core snapshot owns the fresh version.
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import type { CoreRailwayClient } from '@local-creative-os/web-gen2';
import type { RailwaySnapshotV1 } from '@local-creative-os/contracts';
import { useRailwayDestinations } from '../navigation/useRailwayDestinations';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('a failed write keeps the lock until fresh Core read completes; no implicit retry',async()=>{
 const initial:RailwaySnapshotV1={schemaVersion:1,projectId:'p',order:{schemaVersion:1,projectId:'p',version:7,updatedAt:'',orderedRefs:[]},destinations:[],candidates:[],migrationRequired:false};
 let resolveFresh!:(v:RailwaySnapshotV1)=>void;const fresh=new Promise<RailwaySnapshotV1>(resolve=>{resolveFresh=resolve;});
 const client={snapshot:vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(fresh),save:vi.fn().mockRejectedValue(new Error('版本冲突'))};
 let state!:ReturnType<typeof useRailwayDestinations>;function Host(){state=useRailwayDestinations('p',client as unknown as CoreRailwayClient);return null;}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(Host)));
  let pending!:Promise<boolean>;
  await act(async()=>{pending=state.update(s=>s.order.orderedRefs,'saved');await Promise.resolve();});
  expect(state.busy).toBe(true);expect(client.save).toHaveBeenCalledTimes(1);
  await act(async()=>{expect(await state.update(s=>s.order.orderedRefs,'again')).toBe(false);});
  expect(client.save).toHaveBeenCalledTimes(1);
  await act(async()=>{resolveFresh({...initial,order:{...initial.order,version:8}});expect(await pending).toBe(false);});
  expect(state.busy).toBe(false);expect(state.snapshot?.order.version).toBe(8);
  expect(client.save).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());host.remove();}
});
