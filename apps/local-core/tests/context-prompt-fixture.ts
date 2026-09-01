import type { ContextPromptManifestSourceV1 } from '../src/context-prompt-serializer.js'

export function contextPromptFixture(overrides: Partial<ContextPromptManifestSourceV1> = {}): ContextPromptManifestSourceV1 {
  return {
    project: { id: 'project-cache', name: 'Cache Project', graphVersion: 1 },
    target: null,
    orderedItems: [
      {
        role: 'context',
        identity: 'saved:brief:rev-brief',
        title: 'Brief',
        artifactId: 'brief',
        revisionId: 'rev-brief',
        mimeType: 'text/markdown',
        contentHash: 'hash-brief',
        content: 'A stable project brief.',
      },
      {
        role: 'context',
        identity: 'saved:feedback:rev-feedback:pdf:p3-p5',
        title: 'Feedback',
        artifactId: 'feedback',
        revisionId: 'rev-feedback',
        mimeType: 'application/pdf',
        sourceAnchor: 'pdf:p3-p5',
        contentHash: 'hash-feedback',
        content: 'Stable feedback excerpt.',
      },
      {
        role: 'context',
        identity: 'active:reference',
        title: 'Current Reference',
        artifactId: 'reference',
        revisionId: 'rev-reference',
        mimeType: 'image/png',
        contentHash: 'hash-reference',
      },
    ],
    lockedElements: [],
    resourceRefs: [],
    cachePlan: {
      schemaVersion: 1,
      serializerVersion: 'context-prompt-v1',
      savedContextId: 'context-one',
      stableItemIdentities: [
        'saved:brief:rev-brief',
        'saved:feedback:rev-feedback:pdf:p3-p5',
      ],
      focusArtifactIds: ['reference'],
      routeId: 'context_build@v1',
      skillId: 'lcos-curator',
      skillVersion: '4.3',
      capabilityProfileId: 'context-build-v1',
    },
    ...overrides,
  }
}
