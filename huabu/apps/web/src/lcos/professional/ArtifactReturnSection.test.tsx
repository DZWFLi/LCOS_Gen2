// Wave 10：Artifact Return 复核段——capability 门控禁用态 + 采纳决定真实通道调用。
// 真实数据当前没有 pending return，故启用路径在本测试用注入 client 验证接线（契约级，
// 不代表真实 provider 已产出 Draft；真实禁用态由 wave10 golden path 浏览器实测覆盖）。
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactReturnSection } from './ArtifactReturnSection';

import type { RunReview } from '@local-creative-os/contracts';
import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';

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

function fakeRuns(value: readonly RunReview[]): { collaboration: CoreCollaborationClient; approve: ReturnType<typeof vi.fn> } {
  const approve = vi.fn(async () => ({ ok: true as const, receipt: { schemaVersion: 1 as const, command: 'approve' as const, acceptedAt: '2026-09-17T00:00:00.000Z', returnId: 'ret-1' } }));
  const reviews = value.flatMap((review) =>
    review.returns.map((row) => ({
      schemaVersion: 1 as const,
      returnId: String(row.id),
      ...(row.targetArtifactId === undefined ? {} : { artifactId: String(row.targetArtifactId) }),
      title: String(review.run.instruction ?? '未命名产出') || '未命名产出',
      status: row.status,
      baseRevisionId: String(row.baseRevisionId),
      capabilities: review.capabilities,
    })),
  );
  const collaboration = {
    readReviews: async () => reviews,
    approve,
    retry: vi.fn(async () => ({ ok: true as const, receipt: { schemaVersion: 1 as const, command: 'retry' as const, acceptedAt: '2026-09-17T00:00:00.000Z', returnId: 'ret-1' } })),
  } as unknown as CoreCollaborationClient;
  return { collaboration, approve };
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
  it('capabilities 全关时将 pending 行的决定按钮禁用并显示 reason（不假装可用）', async () => {
    const { collaboration } = fakeRuns([
      review({
        returns: [
          {
            id: 'ret-x',
            targetArtifactId: 'artifact-x',
            baseRevisionId: 'revision-base-x',
            action: 'update',
            status: 'pending_review',
          },
        ],
        capabilities: {
          schemaVersion: 1,
          accept: { enabled: false, reason: 'no_pending_artifact_return' },
          reject: { enabled: false, reason: 'no_pending_artifact_return' },
          retry: { enabled: false, reason: 'no_pending_artifact_return' },
        },
      } as unknown as Partial<RunReview>),
    ]);
    const container = await render(
      <ArtifactReturnSection collaboration={collaboration} projectId="p1" conversationId="c-1" />,
    );
    const accept = container.querySelector<HTMLButtonElement>('[data-lcos-return-accept]');
    const reject = container.querySelector<HTMLButtonElement>('[data-lcos-return-reject]');
    const retry = container.querySelector<HTMLButtonElement>('[data-lcos-return-retry]');
    expect(accept).not.toBeNull();
    expect(reject).not.toBeNull();
    expect(retry).not.toBeNull();
    expect(accept?.disabled).toBe(true);
    expect(reject?.disabled).toBe(true);
    expect(retry?.disabled).toBe(true);
    expect(accept?.title).toContain('no_pending_artifact_return');
  });

  it('存在待复核 returns 且 capability 可用时，采纳带 expectedBaseRevisionId 走真实通道', async () => {
    const { collaboration, approve } = fakeRuns([
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
      <ArtifactReturnSection collaboration={collaboration} projectId="p1" conversationId="c-1" />,
    );
    const acceptButton = container.querySelector('[data-lcos-return-accept]');
    expect(acceptButton).not.toBeNull();
    await act(async () => {
      acceptButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(approve).toHaveBeenCalledWith('p1', { returnId: 'ret-1', decision: 'accept', expectedBaseRevisionId: 'revision-base' });
    expect(container.textContent).toContain('已采纳');
  });

  it('无关联 Run 时不渲染（不占位、不伪造空态）', async () => {
    const { collaboration } = fakeRuns([review({})]);
    const container = await render(
      <ArtifactReturnSection collaboration={collaboration} projectId="p1" conversationId="c-1" />,
    );
    expect(container.querySelector('[data-lcos-artifact-return]')).toBeNull();
  });

  it('readReviews 失败时显示 honest error，不把读取失败伪装成空态', async () => {
    const collaboration = {
      readReviews: async () => {
        throw new Error('review backend unavailable');
      },
      approve: vi.fn(),
      retry: vi.fn(),
    } as unknown as CoreCollaborationClient;
    const container = await render(
      <ArtifactReturnSection collaboration={collaboration} projectId="p1" conversationId="c-1" />,
    );
    expect(container.querySelector('[data-lcos-artifact-return]')).not.toBeNull();
    expect(container.textContent).toContain('复核状态读取失败');
    expect(container.textContent).toContain('review backend unavailable');
  });
});
