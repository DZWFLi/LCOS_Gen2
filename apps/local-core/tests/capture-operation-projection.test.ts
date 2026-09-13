import { describe, expect, it } from 'vitest'

import type { CaptureStagingItemV0 } from '@local-creative-os/contracts'
import { captureOperationProjectionsV1 } from '../src/capture-operation-projection.js'

const now = '2026-09-12T00:00:00.000Z'

function item(overrides: Partial<CaptureStagingItemV0> = {}): CaptureStagingItemV0 {
  return {
    id: 'capture-1', operationId: 'op-c-1', kind: 'web_page', payloadRef: 'ref',
    source: { capturedAt: now }, suggestedProjects: [], capturedAt: now, ...overrides,
  }
}

describe('captureOperationProjectionsV1（T6 §3.3）', () => {
  it('无 item → 空列表', () => {
    expect(captureOperationProjectionsV1([], 'p-1')).toEqual([])
  })

  it('未 resolve → unconfirmed，allowed apply/reconcile，target unresolved', () => {
    const value = captureOperationProjectionsV1([item()], 'p-1')
    expect(value).toHaveLength(1)
    expect(value[0]!.outcome).toBe('unconfirmed')
    expect(value[0]!.targetResolution).toEqual({ status: 'unresolved', projectId: null })
    expect(value[0]!.allowedActions).toEqual(['apply', 'reconcile'])
    expect(value[0]!.materializationRefs).toEqual([])
  })

  it('resolved 到当前 project → confirmed，allowed locate/reconcile，materialize 回链', () => {
    const value = captureOperationProjectionsV1([
      item({ resolvedProjectId: 'p-1', resolvedArtifactId: 'artifact-1', resolvedViewId: 'view-1' }),
    ], 'p-1')
    expect(value[0]!.outcome).toBe('confirmed')
    expect(value[0]!.targetResolution).toEqual({ status: 'resolved', projectId: 'p-1' })
    expect(value[0]!.allowedActions).toEqual(['locate', 'reconcile'])
    expect(value[0]!.materializationRefs).toEqual([{ artifactId: 'artifact-1', viewId: 'view-1' }])
  })

  it('resolved 到其它 project → 仅 reconcile（跨项目 apply 不允许）', () => {
    const value = captureOperationProjectionsV1([
      item({ resolvedProjectId: 'p-other', resolvedArtifactId: 'artifact-9' }),
    ], 'p-1')
    expect(value[0]!.outcome).toBe('confirmed')
    expect(value[0]!.allowedActions).toEqual(['reconcile'])
  })

  it('同 operationId 多 item 分组：部分未 resolve → unresolved（partial 不冒充全成）', () => {
    const value = captureOperationProjectionsV1([
      item({ operationId: 'op-multi', resolvedProjectId: 'p-1', resolvedArtifactId: 'a-1' }),
      item({ id: 'capture-2', operationId: 'op-multi', resolvedProjectId: undefined }),
    ], 'p-1')
    expect(value).toHaveLength(1)
    expect(value[0]!.stagingItemIds).toEqual(['capture-1', 'capture-2'])
    expect(value[0]!.outcome).toBe('unconfirmed')
    expect(value[0]!.targetResolution).toEqual({ status: 'unresolved', projectId: null })
    expect(value[0]!.allowedActions).toEqual(['apply', 'reconcile'])
    expect(value[0]!.materializationRefs).toEqual([{ artifactId: 'a-1', viewId: '' }])
  })

  it('按 capturedAt 倒序排列', () => {
    const value = captureOperationProjectionsV1([
      item({ id: 'old', operationId: 'op-old', capturedAt: '2026-09-11T00:00:00.000Z' }),
      item({ id: 'new', operationId: 'op-new', capturedAt: '2026-09-12T00:00:00.000Z' }),
    ], 'p-1')
    expect(value.map((op) => op.operationId)).toEqual(['op-new', 'op-old'])
  })
})
