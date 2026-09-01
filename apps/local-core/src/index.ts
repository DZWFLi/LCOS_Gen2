import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

import { createLocalCoreServer, LOCAL_CORE_DEV_PORT } from './server.js'
import { SqliteMetadataRepository } from './metadata-repository.js'
import { ensureMvpSampleProject } from './mvp-sample-project.js'
import { ContextManifestService } from './context-manifest-service.js'
import { RestBridgeRuntimeClient } from './bridge-rest-client.js'
import { RuntimeAdapterService } from './runtime-adapter.js'
import { RuntimeApplicationService } from './runtime-application-service.js'
import { RuntimeAutoSyncService } from './runtime-auto-sync-service.js'
import { FileObservationService } from './file-observation-service.js'
import { ProjectWatcherService } from './project-watcher-service.js'
import { RuntimeResultIngestionService } from './runtime-result-ingestion.js'
import { RuntimeReviewService } from './runtime-review-service.js'

export { getHealthStatus } from './health.js'
export { ExplicitProjectCatalog } from './project-catalog.js'
export { validateProjectRoot } from './project-root.js'
export { createLocalCoreServer, LOCAL_CORE_DEV_PORT } from './server.js'
export { SqliteMetadataRepository } from './metadata-repository.js'
export { FileRegistryService, TrustedFileSelectionRegistry } from './file-registry-service.js'
export { ImportCopyService } from './import-copy-service.js'
export { UniversalResourceImportService, type ResourceImportOutcome, type ResourceImportUrlInput } from './resources/universal-resource-import-service.js'
export { ResourceDescriptorService, resourceDescriptorHash } from './resources/resource-descriptor-service.js'
export { ResourcePackageService, type ImportArchiveInput, type ImportDirectoryInput, type PackageFileInput, type ResourcePackageOutcome } from './resources/resource-package-service.js'
export { ResourceReader, type ResourceReadOptions, type ResourceReadResult } from './resources/resource-reader.js'
export { ResourceMatcher, type ResourceMatchOptions } from './resources/resource-matcher.js'
export { buildLinkMarkdown } from './resources/link-document.js'
export { assertSafeHttpUrl, UnsafeUrlError } from './resources/url-security.js'
export { readZipArchive, ZipReadError, type ZipEntryData } from './resources/zip-reader.js'
export { AnalyzerRegistry, type ResourceAnalyzer, type ResourceAnalysisInput, type ResourceDescriptorDraft } from './resources/analyzers/analyzer-registry.js'
export { MarkdownAnalyzer } from './resources/analyzers/markdown-analyzer.js'
export { TextAnalyzer } from './resources/analyzers/text-analyzer.js'
export { JsonAnalyzer } from './resources/analyzers/json-analyzer.js'
export { YamlAnalyzer } from './resources/analyzers/yaml-analyzer.js'
export { SkillPackageAnalyzer } from './resources/analyzers/skill-package-analyzer.js'
export { LinkAnalyzer, fetchLinkMetadata } from './resources/analyzers/link-analyzer.js'
export { FallbackAnalyzer } from './resources/analyzers/fallback-analyzer.js'
export { ContextManifestService } from './context-manifest-service.js'
export {
  createTaskRequestFingerprint,
  RuntimeAdapterError,
  RuntimeAdapterService,
} from './runtime-adapter.js'
export { RestBridgeRuntimeClient } from './bridge-rest-client.js'
export { RuntimeResultIngestionService } from './runtime-result-ingestion.js'
export { RuntimeReviewService } from './runtime-review-service.js'
export { RuntimeApplicationService } from './runtime-application-service.js'
export type { CreateRuntimeRunInput, RuntimeRunActionResult } from './runtime-application-service.js'
export type {
  IngestedRuntimeResult,
  RuntimeResultRepository,
} from './runtime-result-ingestion.js'
export type {
  BridgeRuntimePort,
  BridgeResultEnvelopeV0,
  BridgeTaskEnvelopeV0,
  BridgeTaskEnvelopeV1,
  BridgeTaskIdentity,
  RuntimeInputPackV0,
  RuntimeProviderError,
} from './runtime-adapter.js'
export { guardTrustedFilePath } from './path-guard.js'
export { RendererRegistry, DEFAULT_RENDERERS } from './renderer-registry.js'
export {
  SemanticProviderRegistry,
  OllamaEmbeddingProvider,
  RepositoryChunkRetrievalProvider,
  OLLAMA_EMBEDDING_PROVIDER_ID,
  LOCAL_CHUNK_RETRIEVAL_PROVIDER_ID,
} from './semantic-provider-registry.js'
export type {
  EmbeddingProvider,
  RetrievalProvider,
  ContentExtractor,
  VisualEmbeddingProvider,
  SemanticVectorHitV0,
} from './semantic-provider-registry.js'
export { SEARCH_FORMAT_COVERAGE_V0, validateSearchFormatCoverage } from './search-format-coverage.js'
export { PreviewCacheService } from './preview-cache-service.js'
export { PreviewWorkerService } from './preview-worker-service.js'
export { ensureMvpSampleProject, createMvpSampleSnapshot, MVP_SAMPLE_PROJECT_ID } from './mvp-sample-project.js'

async function main(): Promise<void> {
  const databasePath = process.env.LOCAL_CORE_DB_PATH
    ?? fileURLToPath(new URL('../.data/phase2.sqlite', import.meta.url))
  const testPort = process.env.LOCAL_CORE_TEST_PORT
  const port = testPort === undefined ? LOCAL_CORE_DEV_PORT : Number(testPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('LOCAL_CORE_TEST_PORT must be a valid TCP port.')
  }
  const metadataRepository = new SqliteMetadataRepository(databasePath, { disposableOnly: false })
  const apiToken = process.env.LOCAL_CORE_API_TOKEN ?? randomBytes(32).toString('base64url')
  if (process.env.LOCAL_CORE_DISABLE_MVP_SAMPLE !== '1') {
    const sampleRoot = process.env.LOCAL_CORE_MVP_SAMPLE_ROOT
      ?? fileURLToPath(new URL('../.data/mvp-sample-project', import.meta.url))
    ensureMvpSampleProject(metadataRepository, sampleRoot)
  }
  const bridge = new RestBridgeRuntimeClient(
    process.env.LCOS_BRIDGE_URL ?? 'http://127.0.0.1:43122',
    fetch,
  )
  const bridgeProjectId = process.env.LOCAL_CORE_BRIDGE_PROJECT_ID ?? 'mvp-fast-build'
  const runtimeReviewService = new RuntimeReviewService(metadataRepository)
  const runtimeAdapter = new RuntimeAdapterService(metadataRepository, bridge, bridgeProjectId)
  const runtimeApplicationService = new RuntimeApplicationService(
    metadataRepository,
    new ContextManifestService(metadataRepository),
    runtimeAdapter,
    new RuntimeResultIngestionService(metadataRepository, bridge),
    runtimeReviewService,
  )
  const server = createLocalCoreServer({
    port,
    metadataRepository,
    runtimeReviewService,
    runtimeApplicationService,
    apiToken,
  })
  const address = await server.start()
  process.stdout.write(`Local Core Phase 2 listening on http://${address.host}:${address.port}\n`)
  const autoSync = new RuntimeAutoSyncService(
    metadataRepository,
    runtimeApplicationService,
    Number(process.env.LCOS_AUTO_SYNC_MS ?? 10_000),
  )
  autoSync.start()
  const watcher = new ProjectWatcherService(
    metadataRepository,
    new FileObservationService(metadataRepository),
  )
  watcher.start()

  const shutdown = () => {
    autoSync.stop()
    watcher.stop()
    void server.close().then(() => {
      metadataRepository.close()
      process.exit(0)
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const entryUrl = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href
if (entryUrl === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    process.stderr.write(`Local Core failed to start: ${message}\n`)
    process.exitCode = 1
  })
}
