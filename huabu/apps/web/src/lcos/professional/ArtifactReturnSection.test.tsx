// Wave 10：Artifact Return 复核段——capability 门控禁用态 + 采纳决定真实通道调用。
// 真实数据当前没有 pending return，故启用路径在本测试用注入 client 验证接线（契约级，
// 不代表真实 provider 已产出 Draft；真实禁用态由 wave10 golden path 浏览器实测覆盖）。
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactReturnSection } from './ArtifactReturnSection';

import type { RunReview } from '@local-creative-os/contracts';
import type { CoreRunClient } from '@local-creative-os/web-gen2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const container of containers) container.remove();
  roots = [];
  containers = [];
  document.body.replaceChildren();
});

function review(overrides: Partial<RunReview> & { capabilities?: RunReview['capabilities'] }): RunReview {
  return {
    run: { id: 'run-1' },
    dispatch: {},
    returns: [],
    draftRevisions: [],
    presentationPhase: 'review',
    capabilities: {
      schemaVersion: 1,
      accept: { enabled: false, reason: 'no_pending_artifact_return' },
      reject: { enabled: false, reason: 'no_pending_artifact_return' },
      retry: { enabled: false, reason: 'no_pending_artifact_return' },
    },
    ...overrides,
  } as unknown as RunReview;
}

function fakeRuns(value: readonly RunReview[]): { client: CoreRunClient; accept: ReturnType<typeof vi.fn> } {
  const accept = vi.fn(async () => ({ currentRevision: { id: 'revision-next' } }));
  const client = {
    listRunReviews: async () => value,
    acceptArtifactReturn: accept,
    rejectArtifactReturn: vi.fn(async () => ({})),
    retryArtifactReturn: vi.fn(async () => ({})),
  } as unknown as CoreRunClient;
  return { client, accept };
}

async function render(element: React.JSX.Element): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

describe('ArtifactReturnSection', () => {
  it('capabilities 全关时显示真实 reason，且不渲染任何决定按钮（不假装可用）', async () => {
    const { client } = fakeRuns([review({})]);
    const container = await render(
      <ArtifactReturnSection runs={client} projectId="p1" runIds={['run-1']} />,
    );
    const caps = Array.from(container.querySelectorAll('[data-lcos-review-capability]')).map(
      (el) => el.textContent,
    );
    expect(caps.length).toBe(3);
    expect(caps.every((text) => text?.includes('no_pending_artifact_return'))).toBe(true);
    expect(container.querySelector('[data-lcos-return-accept]')).toBeNull();
    expect(container.querySelector('[data-lcos-return-reject]')).toBeNull();
    expect(container.querySelector('[data-lcos-return-retry]')).toBeNull();
  });

  it('存在待复核 returns 且 capability 可用时，采纳带 expectedBaseRevisionId 走真实通道', async () => {
    const { client, accept } = fakeRuns([
      review({
        returns: [
          {
            id: 'ret-1',
            targetArtifactId: 'artifact-1',
            baseRevisionId: 'revision-base',
            action: 'update',
            status: 'pending_review',
          },
        ],
        capabilities: {
          schemaVersion: 1,
          accept: { enabled: true },
          reject: { enabled: true },
          retry: { enabled: true },
        },
      } as unknown as Partial<RunReview>),
    ]);
    const container = await render(
      <ArtifactReturnSection runs={client} projectId="p1" runIds={['run-1']} />,
    );
    const acceptButton = container.querySelector('[data-lcos-return-accept]');
    expect(acceptButton).not.toBeNull();
    await act(async () => {
      acceptButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(accept).toHaveBeenCalledWith('ret-1', { expectedBaseRevisionId: 'revision-base' });
    expect(container.textContent).toContain('已采纳');
  });

  it('无关联 Run 时不渲染（不占位、不伪造空态）', async () => {
    const { client } = fakeRuns([review({})]);
    const container = await render(
      <ArtifactReturnSection runs={client} projectId="p1" runIds={[]} />,
    );
    expect(container.querySelector('[data-lcos-artifact-return]')).toBeNull();
  });
});
