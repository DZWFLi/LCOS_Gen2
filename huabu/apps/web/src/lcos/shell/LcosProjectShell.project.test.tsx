import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { LcosProjectShell } from './LcosProjectShell';
import { useLcosShellStore } from './lcosShellStore';
import { useLcosReferenceStore } from '../lcosReferenceState';

const renders = vi.hoisted(() => [] as { projectId: string; targets: (string | undefined)[]; draft: string[] }[]);
vi.mock('react-router-dom', () => ({ Link: () => null, useNavigate: () => vi.fn() }));
vi.mock('@/store/canvasStore', () => ({ default: (select: (s: { nodes: [] }) => unknown) => select({ nodes: [] }) }));
vi.mock('./LcosGlobalHud', () => ({ LcosGlobalHud: () => null }));
vi.mock('./LcosWorksiteStage', () => ({ LcosWorksiteStage: () => null }));
vi.mock('../surfaces/main/MainWorksite', () => ({ MainWorksite: () => null }));
vi.mock('../surfaces/context/ContextWorksite', () => ({ ContextWorksite: () => null }));
vi.mock('../surfaces/workflow/WorkflowWorksite', () => ({ WorkflowWorksite: () => null, WorkflowHandOverlay: () => null }));
vi.mock('../professional/ProfessionalWindowStage', () => ({ ProfessionalWindowStage: ({ projectId }: { projectId: string }) => {
  renders.push({ projectId, targets: useLcosShellStore.getState().windows.map((w) => w.target), draft: useLcosReferenceStore.getState().orderedNodeReferences().map((ref) => ref.entityId) });
  return null;
} }));

it('never mounts a new project body with the previous project targets, and restores the prior draft on return', async () => {
  const shell = useLcosShellStore.getState();
  const refs = useLcosReferenceStore.getState();
  shell.clear(); refs.reset(); renders.length = 0;
  shell.setProject('a'); refs.setProject('a');
  shell.openWindow('reader', 'A', 'artifact-a');
  shell.setComposerPrompt('draft A');
  refs.addEntityToDraft({ entityId: 'ref-a', entityType: 'artifact' });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = async (projectId: string) => {
    await act(async () => root.render(<LcosProjectShell projectId={projectId} projectName={projectId} surface="main" workspaces={[]} canvasBySurface={{}} surfaceByWorkspace={new Map()} ensureCanvas={async () => undefined} ensureWorkspaceCanvas={async () => undefined} shellStatus="ready" onRetry={() => {}} />));
  };
  try {
    await render('a');
    await render('b');
    const bRenders = renders.filter((value) => value.projectId === 'b');
    expect(bRenders.length).toBeGreaterThan(0);
    expect(bRenders.every((value) => value.targets.length === 0 && value.draft.length === 0)).toBe(true);
    expect(useLcosShellStore.getState().composerPrompt).toBe('');
    await render('a');
    expect(useLcosShellStore.getState().composerPrompt).toBe('draft A');
    expect(renders.at(-1)).toEqual({ projectId: 'a', targets: ['artifact-a'], draft: ['ref-a'] });
  } finally {
    await act(async () => root.unmount()); host.remove(); shell.clear(); refs.reset();
  }
});
