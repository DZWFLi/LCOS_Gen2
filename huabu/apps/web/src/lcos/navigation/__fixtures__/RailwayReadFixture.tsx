/** DEV-only, browser supplies synthetic GET responses. No project creation/writes. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LcosRailway } from '../../shell/LcosRailway';
import '../../../index.css';
function Fixture(){
 const [projectId,setProjectId]=useState('rail-a');
 const [activated,setActivated]=useState('none');
 return <main style={{minHeight:'100vh',background:'#f7f8f8'}}><header style={{padding:24,marginLeft:80}}>
 <h1>Railway · 合成 GET 响应验收</h1><p>仅生产组件，不创建或写入项目。当前：{projectId}</p>
 <button data-test-next onClick={()=>setProjectId('rail-b')}>切换到空项目 B</button><output data-test-activated>{activated}</output></header>
 <LcosRailway projectId={projectId} surfaceByWorkspace={new Map(Array.from({length:20},(_,i)=>['w'+i,'main' as const]))} ensureWorkspaceCanvas={async()=>undefined} activateDestination={target=>setActivated(target.key)}/>
 </main>;
}
if(import.meta.env.DEV){const el=document.getElementById('root');if(el){const root=createRoot(el);root.render(<Fixture/>);import.meta.hot?.dispose(()=>root.unmount());}}
