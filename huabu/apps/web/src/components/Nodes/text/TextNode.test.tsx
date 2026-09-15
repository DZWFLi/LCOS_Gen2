import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { TextNode, type TextNodeType } from './TextNode';

import type { NodeProps } from '@xyflow/react';

const seamBody = vi.hoisted(() => ({ current: undefined as React.ComponentType<{ nodeId: string; nodeType: string; data: Readonly<Record<string, unknown>> }> | undefined }));

vi.mock('@/lcos-seam/nodeBodySlot', () => ({
  useResolvedNodeBody: () => seamBody.current,
}));
vi.mock('@/components/Nodes/NodeWrapper', () => ({
  NodeWrapper: ({ children }: { children?: React.ReactNode }) => <div data-node-wrapper>{children}</div>,
}));
vi.mock('@/hooks/useTextNodeSurface', () => ({
  useTextNodeSurface: () => ({
    draft: 'native text',
    setDraft: vi.fn(),
    bodyProps: {
      effectiveWidth: 280,
      effectiveHeight: 120,
      effectiveFontSize: 16,
      paddingX: 12,
      paddingY: 12,
    },
    nodeWrapperProps: {},
  }),
}));
vi.mock('../shared/TextNodeBody', () => ({
  resolveTextBodyBox: () => ({ width: 280, height: 120 }),
  TextNodeBody: ({ placeholder }: { placeholder: string }) => <textarea data-native-text placeholder={placeholder} />,
}));

const roots: ReturnType<typeof createRoot>[] = [];
const nodeProps = {
  id: 'node-text',
  data: { type: 'text', content: 'native text', label: '材料' },
  selected: false,
} as unknown as NodeProps<TextNodeType>;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  seamBody.current = undefined;
});

function renderNode() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

it('renders the seam body for a bound text node', async () => {
  seamBody.current = ({ nodeId, nodeType }) => <div data-lcos-species-body>{nodeId}:{nodeType}</div>;
  const { container, root } = renderNode();
  await act(async () => root.render(<TextNode {...nodeProps} />));
  expect(container.querySelector('[data-lcos-species-body]')?.textContent).toBe('node-text:text');
  expect(container.querySelector('[data-native-text]')).toBeNull();
});

it('keeps the native editable body when no seam override exists', async () => {
  const { container, root } = renderNode();
  await act(async () => root.render(<TextNode {...nodeProps} />));
  expect(container.querySelector('[data-native-text]')).not.toBeNull();
  expect(container.querySelector('[data-lcos-species-body]')).toBeNull();
});

it('replaces native fallback when a late seam override becomes available', async () => {
  const { container, root } = renderNode();
  await act(async () => root.render(<TextNode {...nodeProps} />));
  expect(container.querySelector('[data-native-text]')).not.toBeNull();
  seamBody.current = () => <div data-lcos-species-body>late body</div>;
  await act(async () => root.render(<TextNode {...nodeProps} data={{ ...nodeProps.data }} />));
  expect(container.querySelector('[data-lcos-species-body]')?.textContent).toBe('late body');
  expect(container.querySelector('[data-native-text]')).toBeNull();
});
