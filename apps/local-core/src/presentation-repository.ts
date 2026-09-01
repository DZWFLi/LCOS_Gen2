import type { PresentationViewV0 } from '@local-creative-os/contracts'

/**
 * PresentationRepository — thin SQL + row-mapping boundary only.
 * It never performs member ownership validation or renderer validation;
 * those belong to PresentationApplicationService.
 */
export interface PresentationRepository {
  getPresentationView(projectId: string, id: string): PresentationViewV0 | undefined
  listPresentationViews(projectId: string): readonly PresentationViewV0[]
  insertPresentationView(value: PresentationViewV0): void
  compareAndSwapPresentationView(value: PresentationViewV0, expectedVersion: number): { readonly updated: boolean; readonly currentVersion: number }
  deletePresentationView(projectId: string, id: string): void
}
