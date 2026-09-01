/** A24 voice transcription transport contract shared by Web and Local Core. */
export interface VoiceTranscriptionSegmentTransportV1 {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

/** Normalized transcript evidence returned by Local Core transport. */
export interface VoiceTranscriptionResponseV1 {
  readonly text: string
  readonly language?: string
  readonly segments?: readonly VoiceTranscriptionSegmentTransportV1[]
  readonly model?: string
  readonly providerId: string
}
