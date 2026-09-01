/**
 * @deprecated B4 now uses provider-neutral IntelligenceProviderService.
 * Keep the export alias for tests/integrations that still construct the old
 * service name; it no longer means "Ollama only".
 */
export {
  IntelligenceProviderService as LocalIntelligenceService,
  type IntelligenceProviderConfigV0,
  type IntelligenceProviderStatusV0,
  type IntelligenceStatusV0 as LocalIntelligenceStatusV0,
  type IntentInferenceInputV0,
  type IntentInferenceResultV0,
} from './intelligence-provider-service.js'
