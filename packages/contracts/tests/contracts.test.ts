import { describe, expectTypeOf, it } from 'vitest'
import type {
  ArtifactContract,
  ContextContract,
  ExecutionRuntimeContract,
  HealthStatus,
  ProjectCatalog,
  ProjectCatalogEntry,
  PreviewContract,
  ProjectContract,
  Result,
  MutationOperation,
  ValidateProjectRootInput,
  ValidatedProjectRoot,
  WorkspaceQueryContract,
} from '../src/index'

describe('Frontend Alpha contract boundaries', () => {
  it('keeps project, artifact, context, and runtime boundaries distinct', () => {
    expectTypeOf<ProjectContract>().not.toEqualTypeOf<ArtifactContract>()
    expectTypeOf<ContextContract>().not.toEqualTypeOf<ExecutionRuntimeContract>()
    expectTypeOf<WorkspaceQueryContract>().not.toEqualTypeOf<PreviewContract>()
    expectTypeOf<Result<string>>().toMatchTypeOf<Result<unknown>>()
  })
})

describe('Phase 2.5 lifecycle mutation boundary', () => {
  it('does not expose revision or checkpoint lifecycle as generic mutations', () => {
    expectTypeOf<Extract<MutationOperation, { type: 'create_checkpoint' }>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<MutationOperation, { type: 'upsert_checkpoint' }>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<MutationOperation, { type: 'upsert_artifact_revision' }>>().toEqualTypeOf<never>()
  })

  it('exposes focused presentation updates without generic entity upserts', () => {
    type WorkspacePresentation = Extract<MutationOperation, { type: 'update_workspace_presentation' }>
    type ArtifactViewPresentation = Extract<MutationOperation, { type: 'update_artifact_view_presentation' }>

    expectTypeOf<WorkspacePresentation>().toHaveProperty('workspaceId')
    expectTypeOf<WorkspacePresentation>().toHaveProperty('focusedViewIds')
    expectTypeOf<WorkspacePresentation>().toHaveProperty('visibleLayers')
    expectTypeOf<ArtifactViewPresentation>().toHaveProperty('viewId')
    expectTypeOf<ArtifactViewPresentation>().toHaveProperty('collapsed')
    expectTypeOf<ArtifactViewPresentation>().toHaveProperty('displayMode')
  })
})

describe('Local Core Phase 1A contracts', () => {
  it('keeps health and read-only project shapes available at the boundary', () => {
    expectTypeOf<HealthStatus>().toMatchTypeOf<{
      status: 'ok'
      service: 'local-core'
      mode: 'read_only_phase_1a' | 'phase_2_lite' | 'phase_2_5'
      version: string
    }>()
    expectTypeOf<ValidateProjectRootInput>().toHaveProperty('rootPath')
    expectTypeOf<ValidatedProjectRoot>().toHaveProperty('readable')
    expectTypeOf<ProjectCatalogEntry>().toHaveProperty('id')
    expectTypeOf<ProjectCatalog>().toHaveProperty('list')
  })
})
