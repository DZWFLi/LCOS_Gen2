import { describe, expect, it } from 'vitest'
import {
  EXECUTION_ITEM_ACTION_STATES,
  deriveAvailableActions,
  executionItemNeedsAttention,
  type ExecutionItemAction,
  type ExecutionItemCapabilities,
  type ExecutionItemState,
} from '../src/execution-item'

const ALL_ENABLED: ExecutionItemCapabilities = { pause: true, resume: true, cancel: true, retry: true, answerInput: true }
const ALL_DISABLED: ExecutionItemCapabilities = { pause: false, resume: false, cancel: false, retry: false, answerInput: false }

/** 规格矩阵：全能力开时每个状态的合法动作（单一事实源，全量断言）。 */
const EXPECTED_FULL_MATRIX: Readonly<Record<ExecutionItemState, readonly ExecutionItemAction[]>> = {
  created: ['cancel'],
  queued: ['cancel'],
  running: ['pause', 'cancel'],
  waiting_input: ['cancel', 'answer_input'],
  completed: [],
  failed: ['retry'],
  cancelled: ['retry'],
}

describe('ExecutionItemV1 deriveAvailableActions', () => {
  it('derives the full state × action matrix with all capabilities enabled', () => {
    for (const [state, expected] of Object.entries(EXPECTED_FULL_MATRIX)) {
      expect(deriveAvailableActions(state as ExecutionItemState, ALL_ENABLED)).toEqual([...expected])
    }
  })

  it('returns an empty array for every state when all capabilities are disabled', () => {
    for (const state of Object.keys(EXPECTED_FULL_MATRIX) as ExecutionItemState[]) {
      expect(deriveAvailableActions(state, ALL_DISABLED)).toEqual([])
    }
  })

  it('never emits an action outside its legal source states (matrix consistency)', () => {
    for (const state of Object.keys(EXPECTED_FULL_MATRIX) as ExecutionItemState[]) {
      const derived = deriveAvailableActions(state, ALL_ENABLED)
      for (const action of derived) {
        expect(EXECUTION_ITEM_ACTION_STATES[action].includes(state)).toBe(true)
      }
    }
  })

  it('resume row is honestly empty until the paused state lands (S7)', () => {
    expect(EXECUTION_ITEM_ACTION_STATES.resume).toEqual([])
    expect(deriveAvailableActions('running', ALL_ENABLED).includes('resume')).toBe(false)
  })

  it('answer_input only derives from waiting_input', () => {
    for (const state of Object.keys(EXPECTED_FULL_MATRIX) as ExecutionItemState[]) {
      const has = deriveAvailableActions(state, ALL_ENABLED).includes('answer_input')
      expect(has).toBe(state === 'waiting_input')
    }
  })

  it('partial capabilities produce exactly the enabled subset', () => {
    const cancelOnly: ExecutionItemCapabilities = { ...ALL_ENABLED, retry: false, answerInput: false, pause: false }
    expect(deriveAvailableActions('failed', cancelOnly)).toEqual([])
    expect(deriveAvailableActions('running', cancelOnly)).toEqual(['cancel'])
    expect(deriveAvailableActions('waiting_input', cancelOnly)).toEqual(['cancel'])
  })
})

describe('ExecutionItemV1 needsAttention', () => {
  it('marks waiting_input and failed, nothing else', () => {
    expect(executionItemNeedsAttention('waiting_input')).toBe(true)
    expect(executionItemNeedsAttention('failed')).toBe(true)
    for (const state of ['created', 'queued', 'running', 'completed', 'cancelled'] as const) {
      expect(executionItemNeedsAttention(state)).toBe(false)
    }
  })
})
