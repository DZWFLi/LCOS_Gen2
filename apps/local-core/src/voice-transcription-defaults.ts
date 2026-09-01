import { createWhisperCppProviderFromEnvironment, type WhisperCppEnvironment } from './voice-transcription-whisper-cpp-provider.js'
import { VoiceTranscriptionProviderRegistry, VoiceTranscriptionService, type VoiceTranscriptionProvider } from './voice-transcription-service.js'

/**
 * Default Local Core composition. Concrete providers remain packaging/runtime
 * concerns and are only registered when their required local assets exist.
 */
export function createDefaultVoiceTranscriptionService(env: WhisperCppEnvironment = process.env): VoiceTranscriptionService {
  const providers: VoiceTranscriptionProvider[] = []
  const whisperCpp = createWhisperCppProviderFromEnvironment(env)
  if (whisperCpp !== undefined) providers.push(whisperCpp)
  return new VoiceTranscriptionService({
    registry: new VoiceTranscriptionProviderRegistry({ providers }),
  })
}
