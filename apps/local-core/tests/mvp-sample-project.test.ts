import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { ensureMvpSampleProject, MVP_SAMPLE_PROJECT_ID } from '../src/mvp-sample-project.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lcos-mvp-sample-'))
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  return { root, sampleRoot: join(root, 'sample-project'), repository }
}

describe('MVP sample project', () => {
  it('creates a real disposable Runtime sample with files, revisions, relations and checkpoint', () => {
    const { sampleRoot, repository } = fixture()
    try {
      expect(ensureMvpSampleProject(repository, sampleRoot)).toBe(true)
      const snapshot = repository.get(String(MVP_SAMPLE_PROJECT_ID))
      expect(snapshot?.project.rootPath).toBe(sampleRoot)
      expect(snapshot?.workspaces.map((workspace) => workspace.name)).toEqual([
        'Brief / Script',
        'Reference / Feedback',
        'Handoff Review',
      ])
      expect(snapshot?.artifacts.map((artifact) => artifact.title)).toEqual([
        'Brief',
        'Script',
        'Reference Image',
        'Feedback Notes',
      ])
      expect(snapshot?.fileRecords).toHaveLength(4)
      expect(snapshot?.artifactRevisions).toHaveLength(4)
      expect(snapshot?.relations).toHaveLength(3)
      expect(snapshot?.notes).toHaveLength(2)
      expect(snapshot?.checkpoints).toHaveLength(1)
      for (const fileRecord of snapshot?.fileRecords ?? []) {
        expect(existsSync(fileRecord.observedPath)).toBe(true)
        expect(fileRecord.availability).toBe('current')
      }
      expect(new Set(snapshot?.artifacts.map((artifact) => artifact.currentRevisionId))).toEqual(
        new Set(snapshot?.artifactRevisions.map((revision) => revision.id)),
      )
    } finally {
      repository.close()
    }
  })

  it('does not overwrite an existing sample project on restart', () => {
    const { sampleRoot, repository } = fixture()
    try {
      expect(ensureMvpSampleProject(repository, sampleRoot)).toBe(true)
      repository.upsertWorkspace({
        ...repository.getWorkspaces(String(MVP_SAMPLE_PROJECT_ID))[0]!,
        name: 'User Edited Workspace',
      })
      expect(ensureMvpSampleProject(repository, sampleRoot)).toBe(false)
      expect(repository.getWorkspaces(String(MVP_SAMPLE_PROJECT_ID))[0]?.name).toBe('User Edited Workspace')
    } finally {
      repository.close()
    }
  })
})
