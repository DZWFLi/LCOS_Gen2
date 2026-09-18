// LCOS Gen2 boundary entry.
// Huabu = Spatial Truth (owned by Huabu Space persistence / RFS).
// LCOS Core = Domain Truth (owned by Local Core).
// Gen2 only provides a thin glue: Http client + RFS client + ProjectionBinding +
// projection adapters. No surface/owner/projection runtime. No geometry in Core.

export { HttpClient, HttpError } from './backend/client.js';
export type { HttpClientConfig, RequestOptions, ResponseMode } from './backend/client.js';

export { CoreApiError, coreRequest, coreEnvelope, unwrapCoreValue, toCoreApiError } from './backend/coreTypes.js';
export type { CoreEnvelope, CoreEnvelopeOk, CoreEnvelopeError } from './backend/coreTypes.js';

export { CoreProjectClient } from './backend/projects.js';
export type { ProjectListItem } from './backend/projects.js';

export { CoreArtifactClient } from './backend/artifacts.js';
export type {
  ArtifactDetailProjection,
  ArtifactDetailRevision,
  ArtifactRunRef,
  RevisionCompareLineV1,
  RevisionCompareResultV1,
} from './backend/artifacts.js';

export { CoreRelationClient } from './backend/relations.js';
export type { RelationPutResult, RelationDeleteResult, RelationCreateInput, RelationCreateResult } from './backend/relations.js';

export { CoreSearchClient } from './backend/search.js';
export type { CoreSearchParams, CoreSearchUsedHereTarget } from './backend/search.js';

export { SqliteBindingStore, createProjectionBindingRegistry } from './backend/sqliteBindingStore.js';

export { HuabuRfsClient, RfsContractError } from './spatial/huabuRfsClient.js';
export type { RfsConfig, SpaceQuery, AgentCanvasCommand, CanvasNodeCreateInput, NodeCreateInputByType, CanvasEdgeRef } from './spatial/huabuRfsClient.js';

export { ProjectionBindingRegistry, MemoryBindingStore, FileBindingStore, bindingKey } from './spatial/projectionBinding.js';
export type { ProjectionBinding, EntityType, SpatialKind, BindingStore, FileSystemLike } from './spatial/projectionBinding.js';

export { ProjectToSpaceProjection, huabuNodeTypeFor } from './spatial/projectToSpaceProjection.js';
export type {
  ArtifactProjectionSource,
  ArtifactKind,
  SpaceEntityProjectionSource,
  ProjectionItemFailure,
  ProjectionBatchReport,
} from './spatial/projectToSpaceProjection.js';

export { RelationProjection } from './spatial/relationProjection.js';
export type { RelationKind, SemanticRelation, CoreRelationWriter, CoreEntityRef, NodeBindingResolver } from './spatial/relationProjection.js';

export { ReconciliationRunner } from './spatial/reconciliationRunner.js';
export type { ReconciliationResult, ReconciliationFailureSummary, ReconciliationDeps } from './spatial/reconciliationRunner.js';

export { HostLifecycleReconciler } from './host/lifecycleReconciler.js';
export type { HostLifecycleReconcilerOptions, ReconcileTrigger } from './host/lifecycleReconciler.js';

export { connectSemantic, ConnectIntentError } from './host/hostConnectIntent.js';
export type { ConnectIntentDeps, SemanticConnectResult } from './host/hostConnectIntent.js';

export { Gen2Host } from './host/projectionFacade.js';
export type { Gen2HostDeps } from './host/projectionFacade.js';

export { createHostSeam } from './host/hostSeam.js';
export type { HostSeam, HostSeamOptions, SemanticConnectIntent, SemanticConnectOutcome, LcosRendererDescriptor, LcosOverlayDescriptor, LcosRecognizerDescriptor } from './host/hostSeam.js';

export { hostExtensionFromSeam } from './integration/huabu/LcosCanvasAdapter.js';
export type { HuabuCanvasHostExtension, HuabuCanvasHostOverlay } from './integration/huabu/LcosCanvasAdapter.js';

export { resolvePresentationDensity, projectScreenSize, SCREEN_DENSITY_THRESHOLDS } from './presentation/nodePresentation.js';
export type { PresentationDensity, InteractionPhase, ExplicitPresentationMode, NodePresentationInput } from './presentation/nodePresentation.js';

export { resolveLcosNodeHostPresentation, resolveLcosInitialGeometryPreset } from './presentation/nodeHostPresentation.js';
export type { LcosHostSurface, LcosNodeHostPresentation, LcosInitialGeometryPreset } from './presentation/nodeHostPresentation.js';
export { stableGlythHash, resolveGlythIdentity, resolveGlythPresentation, glythInputFromCollaborationState, GLYTH_SHAPE_KEYS, GLYTH_IDENTITY_TONES } from './presentation/glythPresentation.js';
export type { GlythShapeKey, GlythIdentityTone, GlythPresentationPose, GlythIdentity, GlythPresentationInput } from './presentation/glythPresentation.js';

export { pointerModifiersOf, isAdditiveSelection, isReferencePick, isAdditiveSelectionExclusively } from './interaction/pointerIntent.js';
export type { PointerModifiers } from './interaction/pointerIntent.js';

export { sameEntityRef, createReferenceControllerState, openComposerReferences, toggleReference, removeReference, orderedReferences } from './interaction/referenceController.js';
export type { ReferenceControllerState, EntityRefLike } from './interaction/referenceController.js';

export {
  idleDrop,
  beginDrop,
  advanceDropIntent,
  anchoringAt,
  inDropPreviewCarryZone,
  completeDropDwell,
  dropDwellRemainingMs,
  confirmDrop,
  failDrop,
  DROP_INTENT_TOKENS,
} from './interaction/semanticDropMachine.js';
export type {
  SemanticDropState,
  DropPayload,
  DropDestination,
  DropIntentSnapshot,
  DropBounds,
  SurfacePoint,
} from './interaction/semanticDropMachine.js';

export {
  compactRestingOverlays,
  visibleOverlays,
  overlayZ,
  overlayLayers,
} from './interaction/overlayArbitration.js';

export { createContinuationLocalIntentV1 } from './interaction/continuationIntent.js';
export type { ContinuationIntentBindingV1, ContinuationLocalIntentV1, ContinuationLocalIntentKindV1 } from './interaction/continuationIntent.js';
export { CONTINUATION_ACTION_DESCRIPTORS, describeContinuationActionV1, intentKindForContinuationActionV1, assertKnownContinuationActionsV1 } from './interaction/actionArcModel.js';
export type { ContinuationActionDescriptorV1 } from './interaction/actionArcModel.js';
export { createT3InteractionSnapshotV1, isT3SnapshotStaleV1 } from './interaction/t3InteractionSnapshot.js';
export type { T3InteractionSnapshotV1, T3InteractionSnapshotInputV1 } from './interaction/t3InteractionSnapshot.js';

export { resolveCanonicalConversationTargetV1, resolveCanonicalWorkViewTargetV1, resolveCanonicalViewTargetV1 } from './navigation/canonicalTargetResolver.js';
export type { CanonicalNavigationTargetV1, CanonicalTargetResolveStatusV1, CanonicalTargetResolveOutcomeV1, ConversationTargetInputV1 } from './navigation/canonicalTargetResolver.js';
export { targetFromCaptureReceiptV1 } from './navigation/captureReceiptTarget.js';
export type { CaptureReceiptTargetResultV1, CaptureReceiptTargetInputV1 } from './navigation/captureReceiptTarget.js';
export { focusOccurrenceV1 } from './navigation/focusOccurrence.js';
export type { FocusOccurrenceOutcomeV1, FocusOccurrenceInputV1, FocusOccurrenceStatusV1 } from './navigation/focusOccurrence.js';
export { occurrenceRowLabel, SURFACE_LABEL as OCCURRENCE_SURFACE_LABEL } from './navigation/occurrenceLabel.js';
export type { OccurrenceRowSource } from './navigation/occurrenceLabel.js';
export type {
  OverlayKind,
  OverlayInput,
} from './interaction/overlayArbitration.js';

export { SurfaceRegistry } from './spatial/surfacePort.js';
export type { SurfaceDescriptor, SurfacePort, SurfacePorts, SurfaceCapability, SurfaceKeyName } from './spatial/surfacePort.js';

export { descriptorFor, familiesFor, createNodeCardRegistry } from './presentation/rendererRegistry.js';
export type { NodeCardRegistry } from './presentation/rendererRegistry.js';

export { resolveVisualFamily, huabuNodeTypeForFamily } from './presentation/visualFamily.js';
export type { LcosVisualFamily, VisualFamilySource } from './presentation/visualFamily.js';

export { resolveNodeSpecies, resolveNodeSpeciesFromEntityType, NODE_SPECIES_LABEL } from './presentation/nodeSpecies.js';
export type { LcosNodeSpecies, NodeSpeciesSource } from './presentation/nodeSpecies.js';

export { buildNodeSecondaryLine, describeProjectedEntity, resolveNodeSpeciesFromFacts, buildContentPreview } from './presentation/projectedNodeDescriptor.js';
export type { ProjectedEntityFacts, ProjectedNodeDescriptor } from './presentation/projectedNodeDescriptor.js';

export {
  buildLcosNodeCommands,
  isLcosNodeDeleteAllowed,
  primaryNodeCommands,
} from './interaction/nodeCommandModel.js';
export type {
  LcosNodeCommand,
  LcosNodeCommandGroup,
  LcosNodeCommandId,
  LcosNodeCommandInput,
} from './interaction/nodeCommandModel.js';

export { FIGMA_ENTRY_GROUP_STATES, mapFigmaStateToT5StatusV1, assertAllFigmaStatesMappedV1 } from './presentation/figmaStateMap.js';
export type { FigmaEntryGroupV1, T5PresentationStatusV1 } from './presentation/figmaStateMap.js';

export { huabuNodeTypeForPresentation } from './spatial/projectToSpaceProjection.js';
export { fitBoundsWithInsets, NO_INSETS, DEFAULT_FIT_MIN_ZOOM, DEFAULT_FIT_MAX_ZOOM, DEFAULT_FIT_PADDING } from './spatial/fitWithInsets.js';
export type { FitOptions, FitResult, ContentBounds, SafeInsets, ViewportSize } from './spatial/fitWithInsets.js';

// T2 C2-3A Locator（纯几何 + 瞬态状态，React-free）— Wave 0 从 bb047e2 选择性救回。
export { computeLocatorGeometry, toScreenRect } from './spatial/locatorGeometry.js';
export type {
  LocatorGeometry,
  LocatorGeometryInput,
  LocatorStateKind,
  ScreenRect,
} from './spatial/locatorGeometry.js';
export { reduceLocatorState, initialLocatorState } from './interaction/locatorState.js';
export type { LocatorAction, LocatorPhase, LocatorState } from './interaction/locatorState.js';
export { reduceArrivalState, initialArrivalState } from './interaction/arrivalState.js';
export type { ArrivalAction, ArrivalPhase, ArrivalState } from './interaction/arrivalState.js';
export type { SpatialFocusMode, SpatialFocusPort, SpatialFocusResult } from './spatial/spatialFocusPort.js';

export { createLcosHostRuntime, DOCK_GAP_REGISTRY } from './host/createLcosHostRuntime.js';
export type { LcosEndpointConfig, LcosHostRuntime, CreateLcosRuntimeDeps, PhaseCDock, DockGapRegistry } from './host/createLcosHostRuntime.js';
export type { RendererFamily, PresentationSpecies, PresentationDescriptor, NodeCapability, CoreEntityRefLoose } from './presentation/rendererRegistry.js';

export { CoreConversationClient } from './backend/conversations.js';
export { CoreCollaborationClient } from './backend/collaboration.js';
export { CoreAssemblyClient, warehouseQueryStringV1 } from './backend/assembly.js';
export { CoreRailwayClient } from './backend/railway.js';
export type { RailwayOrderWriteInputV1 } from './backend/railway.js';
export { railwayRefKeyV1, reorderRailwayRefV1, removeRailwayRefV1 } from './navigation/railwayOrder.js';
export type { RailwayReorderPlacementV1 } from './navigation/railwayOrder.js';
export { CoreContinuationClient } from './backend/continuation.js';
export { CoreRunClient } from './backend/runs.js';
export type { CreateRunInputV1 } from './backend/runs.js';
export { CoreDraftClient } from './backend/drafts.js';
export { CoreCaptureClient } from './backend/captures.js';
export { CoreCaptureSpaceClient } from './backend/captureSpace.js';
export { CoreResourceClient } from './backend/resources.js';
export type { ResourceSummaryV1 } from './backend/resources.js';
export { CoreSkillCatalogClient } from './backend/skills.js';
export { CoreColorPinClient } from './backend/colorPins.js';
export type { ColorPinAssignInputV1, ColorPinMutationReceiptV1, ColorPinRemoveReceiptV1 } from './backend/colorPins.js';
export { CoreNavigationClient } from './backend/navigation.js';
export { CoreConnectorClient } from './backend/connectors.js';
export { CoreHealthClient } from './backend/health.js';

export { composerViewStateV1, COMPOSER_VIEW_STATES_V1 } from './composer/composerSubmitMapper.js';
export type { ComposerViewStateV1, ComposerSubmitOutcomeV1, ComposerViewInputV1 } from './composer/composerSubmitMapper.js';
export { ComposerController } from './composer/composerController.js';
export type { ComposerControllerStateV1, ComposerReferenceLikeV1 } from './composer/composerController.js';

export {
  professionalRegionRefV1,
  rectsOverlapV1,
  placeProfessionalRegionV1,
  deriveProfessionalWindowEnvironmentV1,
  safeInsetsFromRectV1,
  clampProfessionalRectV1,
  resizeProfessionalRectV1,
} from './windows/professionalWindowLayout.js';
export type {
  ProfessionalBodyKeyV1,
  ProfessionalRectV1,
  ProfessionalRegionRefV1,
  ProfessionalWindowEnvironmentV1,
  ProfessionalRegionLayoutV1,
  ProfessionalRegionPlacementV1,
  ProfessionalEdgeInsetsV1,
  ProfessionalResizeHandleV1,
} from './windows/professionalWindowLayout.js';

export { createEmptyConversationWorkViewV1 } from './lcos/conversation/conversationWorkViewModel.js';
export type { ConversationWorkViewSectionKindV1, ConversationWorkViewSectionStatusV1, ConversationWorkViewSectionStateV1, ConversationWorkViewStateV1 } from './lcos/conversation/conversationWorkViewModel.js';
export { ConversationWorkViewController } from './lcos/conversation/conversationWorkViewController.js';
export { AssemblySourceBayController, ASSEMBLY_WAREHOUSE_PAGE_SIZE, dedupeWarehouseItems } from './lcos/assembly/assemblySourceBayController.js';
export type { AssemblySourceTabV1, AssemblySourceBayStateV1, AssemblyPathStatusV1, AssemblySourceBayDepsV1, WarehouseItemLikeV1 } from './lcos/assembly/assemblySourceBayController.js';
export { assemblyCardViewV1, referenceKeyForAssemblyItem } from './lcos/assembly/assemblyCardView.js';
export type { AssemblyCardSpeciesV1, AssemblyCardViewStateV1 } from './lcos/assembly/assemblyCardView.js';
export { CaptureInboxController } from './lcos/capture/captureInboxController.js';
export type { CaptureInboxControllerStateV1 } from './lcos/capture/captureInboxController.js';
export { captureInboxViewStateV1, captureOperationActionLabelV1 } from './lcos/capture/captureInboxMapper.js';
export type { CaptureInboxViewStateV1, CaptureInboxViewInputV1 } from './lcos/capture/captureInboxMapper.js';
export { ConnectorSourceController } from './lcos/connector/connectorSourceController.js';
export type { ConnectorSourceControllerStateV1 } from './lcos/connector/connectorSourceController.js';
export { connectorSourceViewStateV1 } from './lcos/connector/connectorSourceMapper.js';
export type { ConnectorSourceViewStateV1, ConnectorSourceViewInputV1 } from './lcos/connector/connectorSourceMapper.js';
export { runtimeDoctorViewStateV1 } from './lcos/doctor/runtimeDoctorMapper.js';
export type { RuntimeDoctorViewStateV1, RuntimeDoctorViewInputV1 } from './lcos/doctor/runtimeDoctorMapper.js';

export {
  HUABU_PROTOCOL_VERSION,
  CANVAS_NODE_TYPES,
  AGENT_CREATABLE_NODE_TYPES,
  NODE_FONT_FAMILIES,
  NODE_FONT_WEIGHTS,
} from './spatial/types.js';
export type {
  CanvasNodeType,
  AgentCreatableNodeType,
  Point,
  NodeSize,
  NodeGeometrySize,
  Geometry,
  EdgeStyle,
  PersistedEdgeStyle,
  AgentRfsEdgeStyle,
  NodeStyle,
  AgentNodeDataPatch,
  Rect,
  SpaceQueryResponse,
  SpaceNodeResult,
  SpaceOutlineResult,
  InspectNodesResult,
  InspectEdgesResult,
  SearchResult,
  SnapshotNodesResult,
  RfsExecuteResponse,
  RfsCapabilitiesResponse,
} from './spatial/types.js';
