import { Plus } from 'lucide-react';
import { composerInputKey, restoredComposerCaret } from './composerInputJourney';
import { draftReferenceUnavailableReason, snapshotDraftReference, runReferenceUnavailableReason } from './referenceSnapshot';
import { draftReferenceKey, sameDraftReference } from '../referenceBridge';
// LcosComposerHost — 统一提交入口（Figma Composer READY；T3-A04 机制）。
// 显式引用 strip（reference store draft）+ 文本；Cmd/Ctrl+Enter 提交真实 Run（CoreRunClient.createRun）。
// 提交后回执展示；失败保留草稿文本；不伪造成功。Draft 是 local UI intent，Run truth 在 Core。
// workspaceId 必须用当前现场的真实 workspace（由 Shell 从 Core workspaces 反查传入）——
// 写死 'main' 会被 Core 外键拒绝（FOREIGN KEY constraint failed → 409）。

import { CoreCollaborationClient, HttpError } from '@local-creative-os/web-gen2';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CanvasFloatingPopover,
  type CanvasAnchorRect,
} from '@/components/Common/CanvasFloatingPopover';
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import useCanvasStore from '@/store/canvasStore';

import { ComposerReferencePicker } from './ComposerReferencePicker';
import {
  buildComposerContinuationInput,
  buildComposerRunInput,
  canSubmitComposerContinuation,
  canSubmitComposerTarget,
} from './composerSubmission';
import { LcosReceiverIdentity } from './LcosReceiverIdentity';
import { referenceImageSource } from './referenceImageSource';
import { useComposerContinuation } from './useComposerContinuation';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { isDropPointExposed } from '../drop/dropOcclusion';
import { rectFromDomRect } from '../drop/dropTargetRegistry';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { buildSelectedContextReferences } from '../professional/conversationContinuationActions';
import { ConversationContinuationControls } from '../professional/ConversationContinuationControls';
import { conversationSendKey, conversationSendWasRecorded, hasUnconfirmedConversationMessage, isComposerSendShortcut } from './conversationSendAttempt';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import type { CollaborationSendInputV1 } from '@local-creative-os/contracts';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { ScaleIn } from '../ui/motion/ScaleIn';
import { LcosComposerView } from '../ui/nearfield/LcosComposerView';
import { LcosNearfieldGlyph } from '../ui/nearfield/LcosNearfieldGlyph';
import { LcosIconButton } from '../ui/primitives/LcosIconButton';
import { createVoiceInput, isVoiceInputSupported, mergeVoiceText } from '../voiceInput';

import type { DropTargetRegistration } from '../drop/dropTypes';
import type { CoreEntityRefLike } from '../referenceBridge';

const ENTITY_LABEL: Readonly<Record<string, string>> = {
  artifact: '材料',
  conversation: '会话',
  note: '便签',
  resource: '资源',
  context: '上下文',
  workflow: '工作流',
  scene: '现场',
  collection: '集合',
};

function referenceLabel(ref: {
  readonly entityType: string;
  readonly displayLabel?: string;
  readonly descriptor?: { readonly title?: string };
}): string {
  return (
    ref.displayLabel ??
    ref.descriptor?.title ??
    ENTITY_LABEL[ref.entityType] ??
    '引用'
  );
}

export interface LcosComposerHostProps {
  readonly projectId: string;
  /** 当前现场的真实 workspaceId（缺省 = 现场未就绪，不可提交）。 */
  readonly workspaceId?: string;
  readonly anchor: CanvasAnchorRect | null;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Work View reuses this exact Composer inline; canvas callers keep the popover host. */
  readonly inline?: boolean;
}

type ComposerState = 'idle' | 'submitting' | 'done' | 'error';
type VoiceState = 'idle' | 'recording' | 'transcribing';

interface VoiceTranscriptionEnvelope {
  readonly ok: boolean;
  readonly value?: { readonly text?: string };
  readonly error?: { readonly message?: string; readonly userMessage?: string };
}

export function LcosComposerHost({
  projectId,
  workspaceId,
  anchor,
  open,
  onClose,
  inline = false,
}: LcosComposerHostProps): React.JSX.Element | null {
  const session = useMemo(() => createLcosCoreSession(), []);
  const collaboration = useMemo(() => new CoreCollaborationClient(session.http), [session]);
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);
  const text = useLcosShellStore((s) => s.composerPrompt);
  const composerTarget = useLcosShellStore((s) => s.composerTarget);
  const retainedSend = useLcosShellStore((s) => composerTarget?.receiverConversationId
    ? s.conversationSendAttempts.get(conversationSendKey(projectId, composerTarget.receiverConversationId)) : undefined);
  const setText = useLcosShellStore((s) => s.setComposerPrompt);
  const [state, setState] = useState<ComposerState>('idle');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [createdRun, setCreatedRun] = useState<{ projectId: string; runId: string } | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const focusVersion = useLcosShellStore((s) => s.composerFocusVersion);
  const inspectRequest = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceSurfaceRef = useRef<HTMLDivElement>(null);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceHandle = useRef<ReturnType<typeof createVoiceInput>>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceInsertion = useRef<{ readonly start: number; readonly end: number } | undefined>(undefined);
  const mounted = useRef(true);
  const pendingSubmission = useRef<symbol | null>(null);
  const referencePickOwner = useLcosReferenceStore((s) => s.referencePickOwner);
  const presentationKey = JSON.stringify([projectId, composerTarget?.nodeId, composerTarget?.intent, composerTarget?.receiverConversationId]);
  const inputKey = composerInputKey(composerTarget);
  const rememberCaret = (): void => {
    const editor = textareaRef.current;
    if (editor && inputKey) useLcosShellStore.getState().rememberComposerCaret({ projectId,
      targetKey: inputKey, text: editor.value, start: editor.selectionStart, end: editor.selectionEnd });
  };
  useEffect(() => () => { inspectRequest.current?.abort(); }, [projectId, inputKey]);
  useEffect(() => {
    if (!open || !focusVersion || !inputKey) return;
    const frame = requestAnimationFrame(() => {
      const editor = textareaRef.current;
      if (!editor?.isConnected || editor.closest('[hidden], [inert]')) return;
      const current = useLcosShellStore.getState();
      if (current.projectId !== projectId || composerInputKey(current.composerTarget) !== inputKey) return;
      const caret = restoredComposerCaret(current.composerCaret, projectId, inputKey, current.composerPrompt);
      editor.focus({ preventScroll: true }); editor.setSelectionRange(caret.start, caret.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, projectId, inputKey, focusVersion]);

  const inspectReference = async (ref: CoreEntityRefLike, title: string): Promise<void> => {
    if (!inputKey) return;
    rememberCaret(); inspectRequest.current?.abort();
    const request = new AbortController(); inspectRequest.current = request;
    try {
      let artifactId = ref.entityType === 'artifact' ? ref.entityId : ref.artifactId;
      let revisionId = ref.revisionId;
      if (!artifactId || !revisionId) {
        const graph = await session.projects.getProjectGraph(projectId);
        const viewId = ref.entityType === 'view' || ref.entityType === 'artifactView' ? ref.entityId : ref.artifactViewId;
        const view = viewId ? graph?.artifactViews.find((candidate) => String(candidate.id) === viewId) : undefined;
        if (viewId && (!view || (artifactId && String(view.artifactId) !== artifactId))) throw new Error('原引用暂不可读取，未替换为其他材料。');
        artifactId = artifactId ?? (view ? String(view.artifactId) : undefined);
        const artifact = graph?.artifacts.find((candidate) => String(candidate.id) === artifactId);
        if (!artifact || String(artifact.projectId) !== projectId) throw new Error('原引用不属于当前项目。');
        revisionId = view?.revisionId ? String(view.revisionId) : artifact.currentRevisionId ? String(artifact.currentRevisionId) : undefined;
      }
      if (request.signal.aborted) return;
      const shell = useLcosShellStore.getState();
      if (shell.projectId !== projectId || composerInputKey(shell.composerTarget) !== inputKey) return;
      if (!artifactId || !revisionId) throw new Error('原引用没有可读版本，未打开最新版替代。');
      shell.openReader(title, artifactId, { revisionId, composerOriginKey: inputKey });
    } catch (error) {
      if (!request.signal.aborted) { setState('error'); setErrorDetail(error instanceof Error ? error.message : '引用读取失败'); }
    }
  };
  const picking = referencePickOwner === presentationKey;
  useEffect(() => {
    if (!open || state === 'submitting') {
      if (useLcosReferenceStore.getState().referencePickOwner === presentationKey) useLcosReferenceStore.getState().setReferencePickOwner(null);
    }
    return () => {
      if (useLcosReferenceStore.getState().referencePickOwner === presentationKey) useLcosReferenceStore.getState().setReferencePickOwner(null);
    };
  }, [open, presentationKey, state]);
  useEffect(() => {
    if (!open || !picking || referencePickerOpen) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      useLcosReferenceStore.getState().setReferencePickOwner(null);
      textareaRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [open, picking, referencePickerOpen]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      voiceAbort.current?.abort();
      voiceHandle.current?.cancel();
    };
  }, []);
  useEffect(() => {
    setState('idle');
    setReceipt(null);
    setErrorDetail(undefined);
    setReferencePickerOpen(false);
    pendingSubmission.current = null;
    voiceAbort.current?.abort();
    voiceHandle.current?.cancel();
    voiceHandle.current = null;
    voiceInsertion.current = undefined;
    setVoiceState('idle');
    setVoiceError(null);
  }, [presentationKey]);

  const nodes = useCanvasStore((state) => state.nodes);
  const canvasId = useCanvasStore((state) => state.canvasId);
  const nodeBindings = useLcosReferenceStore((state) => state.nodeEntityRefs);
  const registerTarget = useLcosDropStore((s) => s.registerTarget);
  const unregisterTarget = useLcosDropStore((s) => s.unregisterTarget);
  const composerDropId = `composer:${JSON.stringify([projectId, composerTarget?.nodeId, composerTarget?.intent, composerTarget?.receiverConversationId])}`;
  const referenceDropActive = useLcosDropStore((s) => s.resolution?.status === 'ready'
    && s.resolution.intent.kind === 'composer-reference'
    && s.resolution.intent.targetId === composerDropId
    && (s.state.status === 'preview' || s.state.status === 'committing'));
  const isContinuation = composerTarget?.intent === 'continue';
  const continuation = useComposerContinuation(projectId, composerTarget, open);
  const unsupportedContinuationRefs = isContinuation
    ? draftRefs.filter((ref) => draftReferenceUnavailableReason(ref, 'continue')).map(referenceLabel)
    : [];
  const continuationIdentityBlockedReason = isContinuation
    ? continuation.blockedReason
      ?? (composerTarget?.receiverConversationId === undefined
        ? '当前会话身份尚未解析，暂不能继续'
        : composerTarget.continuationOperationId === undefined || composerTarget.messageId === undefined
          ? '续聊操作尚未准备好，请从会话窗口重新打开'
          : undefined)
    : undefined;

  const continuationBlockedReason = continuationIdentityBlockedReason
    ?? (!retainedSend && composerTarget?.receiverConversationId && hasUnconfirmedConversationMessage(projectId, composerTarget.receiverConversationId, continuation.diagnostics)
      ? '原消息提交结果未确认，请先在会话窗口核对原消息' : undefined)
    ?? (unsupportedContinuationRefs.length > 0 ? `当前草稿包含暂不支持的续聊引用：${unsupportedContinuationRefs.join('、')}` : undefined);
  // A lost HTTP response need not trap an acknowledged message forever. This only
  // reads the existing exact journal; attach/unknown/missing receipts keep the ticket.
  useEffect(() => {
    if (!retainedSend || retainedSend.phase !== 'unconfirmed' || !conversationSendWasRecorded(retainedSend, continuation.diagnostics)) return;
    const shell = useLcosShellStore.getState();
    const references = useLcosReferenceStore.getState();
    if (composerTarget && references.projectId === projectId
      && JSON.stringify(buildSelectedContextReferences(references.draft.orderedEntityRefs).orderedReferences) === JSON.stringify(retainedSend.input.orderedReferences ?? [])) {
      shell.clearSubmittedComposerPrompt(projectId, composerTarget, retainedSend.input.text);
    }
    shell.settleConversationSend(retainedSend, true);
  }, [retainedSend, continuation.diagnostics, composerTarget, projectId]);

  useCloseOnEscape(open && !referencePickerOpen && !picking, onClose);

  // T3 §17: both the reference strip and editor accept this-run references.
  // Keep receiver identity outside this area: dropping there is not a receiver switch.
  // The registry is live gesture geometry; the draft and Run remain owned by
  // their existing stores/clients.
  useEffect(() => {
    if (!open || projectId.length === 0 || composerTarget === null || referenceSurfaceRef.current === null) return;
    const targetId = composerDropId;
    const target: Omit<DropTargetRegistration, 'rect'> = {
      targetId,
      kind: 'composer-reference',
      label: 'Composer 引用区',
      priority: 30,
      enabled: state !== 'submitting' && retainedSend?.phase !== 'sending',
      ineligibleReason: '消息正在发送，暂不能修改本轮引用',
      semantic: { kind: 'composer-reference', intent: composerTarget.intent, inputKey: composerInputKey(composerTarget) ?? undefined },
      acceptsPoint: (point) => {
        const element = referenceSurfaceRef.current;
        return element !== null && isDropPointExposed(element, point);
      },
      readRect: () => {
        const editor = referenceSurfaceRef.current;
        return editor?.isConnected ? rectFromDomRect(editor.getBoundingClientRect()) : undefined;
      },
    };
    const publish = (): void => {
      const editor = referenceSurfaceRef.current;
      if (editor === null) return;
      registerTarget({ ...target, rect: rectFromDomRect(editor.getBoundingClientRect()) });
    };
    publish();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(publish)
      : null;
    observer?.observe(referenceSurfaceRef.current);
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
      unregisterTarget(targetId);
    };
  }, [composerDropId, composerTarget, open, projectId, state, retainedSend?.phase, registerTarget, unregisterTarget]);

  if (!open || (!inline && anchor === null) || projectId.length === 0) return null;

  const runReferenceBlockedReason = isContinuation ? undefined
    : [...(composerTarget?.targetReferences ?? []), ...draftRefs].map(runReferenceUnavailableReason).find(Boolean);
  const canSubmit = !runReferenceBlockedReason && draftRefs.every((ref) => draftReferenceUnavailableReason(ref, composerTarget?.intent) === undefined) && buildSelectedContextReferences(draftRefs).unsupportedEntityTypes.length === 0 && composerTarget !== null && state !== 'submitting' && (
    isContinuation
      ? retainedSend === undefined && continuationBlockedReason === undefined && canSubmitComposerContinuation(composerTarget, text, draftRefs)
      : canSubmitComposerTarget(composerTarget, text, workspaceId)
  );

  const submit = async (retryInput?: CollaborationSendInputV1): Promise<void> => {
    if (!composerTarget || pendingSubmission.current !== null) return;
    const liveShell = useLcosShellStore.getState();
    const liveReferences = useLcosReferenceStore.getState();
    if (liveShell.projectId !== projectId || liveReferences.projectId !== projectId
      || composerInputKey(liveShell.composerTarget) !== composerInputKey(composerTarget)) return;
    if (retryInput === undefined && (liveShell.composerPrompt !== text
      || JSON.stringify(buildSelectedContextReferences(liveReferences.draft.orderedEntityRefs)) !== JSON.stringify(buildSelectedContextReferences(draftRefs)))) return;
    if (retryInput === undefined && !canSubmit) return;
    if (retryInput !== undefined && (!isContinuation || continuationIdentityBlockedReason !== undefined
      || retainedSend?.phase !== 'unconfirmed' || retryInput !== retainedSend.input)) return;
    const continuationInput = isContinuation ? retryInput ?? buildComposerContinuationInput({
      conversationId: composerTarget.receiverConversationId as string,
      continuationOperationId: composerTarget.continuationOperationId as string,
      messageId: composerTarget.messageId as string, text, refs: draftRefs,
    }) : undefined;
    const sendAttempt = continuationInput === undefined ? undefined
      : useLcosShellStore.getState().beginConversationSend(projectId, continuationInput);
    if (continuationInput && !sendAttempt) return;
    const submission = Symbol('composer-submission');
    pendingSubmission.current = submission;
    const isCurrent = (): boolean => {
      const shell = useLcosShellStore.getState();
      return mounted.current && shell.projectId === projectId
        && shell.composerOpen && shell.composerTarget === composerTarget;
    };
    setState('submitting');
    setErrorDetail(undefined);
    setReceipt(null);
    const refs: readonly CoreEntityRefLike[] = draftRefs;
    const request = sendAttempt !== undefined
      ? collaboration.send(projectId, sendAttempt.input)      : workspaceId === undefined
        ? Promise.resolve({ ok: false as const, error: { userMessage: '现场未就绪（未解析到 workspace），暂不可提交' } })
        : Promise.resolve().then(() => collaboration.delegate(projectId, buildComposerRunInput({
          projectId,
          instruction: text.trim(),
          workspaceId,
          target: composerTarget,
          refs,
        })));
    void request
      .then((result) => {
        if (sendAttempt && !result.ok) useLcosShellStore.getState().settleConversationSend(sendAttempt, false);
        if (result.ok) {
          const runId = result.receipt.runId;
          if (isCurrent()) {
            setState('done');
            if (!isContinuation && runId) setCreatedRun({ projectId, runId });
            setReceipt(
            isContinuation
              ? '消息已提交 · 等待会话回应'
              : runId !== undefined
              ? '任务已创建 · 等待执行'
              : '请求已提交 · 请在会话中核对结果',
          );
          }
          // The user may have changed projects, receiver, or draft while awaiting Core.
          const currentRefs = buildSelectedContextReferences(useLcosReferenceStore.getState().draft.orderedEntityRefs);
          if (!sendAttempt || (useLcosReferenceStore.getState().projectId === projectId
            && JSON.stringify(currentRefs.orderedReferences) === JSON.stringify(sendAttempt.input.orderedReferences ?? []))) {
            useLcosShellStore.getState().clearSubmittedComposerPrompt(projectId, composerTarget, sendAttempt?.input.text ?? text);
          }
          if (sendAttempt) useLcosShellStore.getState().settleConversationSend(sendAttempt, true);
          if (composerTarget.receiverConversationId) void useCollaborationSessionStore.getState().refresh(projectId, composerTarget.receiverConversationId);
        } else if (isCurrent()) {
          // 产品错误（capability/conflict/offline）：草稿保留，如实显示用户可读原因。
          setState('error');
          setErrorDetail(result.error.userMessage);
        }
      })
      .catch((error: unknown) => {
        if (sendAttempt) useLcosShellStore.getState().settleConversationSend(sendAttempt, false);
        if (!isCurrent()) return;
        setState('error');
        setErrorDetail(
          error instanceof HttpError
            ? `${error.message} (${error.status})`
            : String(error),
        );
      }).finally(() => {
        if (pendingSubmission.current === submission) pendingSubmission.current = null;
      });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const position = event.currentTarget.selectionStart;
    if (event.key === '@' && !event.nativeEvent.isComposing && (position === 0 || /\s/.test(text[position - 1] ?? ''))) {
      event.preventDefault();
      setReferencePickerOpen(true);
      return;
    }
    if (isComposerSendShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
      event.preventDefault();
      void submit();
    }
  };

  const toggleVoiceInput = (): void => {
    if (voiceState === 'recording') {
      voiceHandle.current?.stop();
      return;
    }
    if (voiceState === 'transcribing') return;
    setVoiceError(null);
    const handle = createVoiceInput({
      onStart: () => setVoiceState('recording'),
      onResult: ({ audio, durationMs }) => {
        setVoiceState('transcribing');
        const form = new FormData();
        const extension = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm';
        form.append('file', audio, `composer-voice.${extension}`);
        form.append('durationMs', String(durationMs));
        form.append('language', 'zh-CN');
        const controller = new AbortController();
        voiceAbort.current = controller;
        void session.http.postForm<VoiceTranscriptionEnvelope>('/runtime/voice/transcriptions', form, controller.signal)
          .then((response) => {
            if (!response.ok) throw new Error(response.error?.userMessage ?? response.error?.message ?? '语音转写失败');
            const transcript = response.value?.text?.trim();
            if (!transcript) throw new Error('Core 没有返回可用文本');
            const shell = useLcosShellStore.getState();
            const activePresentationKey = JSON.stringify([
              shell.projectId,
              shell.composerTarget?.nodeId,
              shell.composerTarget?.intent,
              shell.composerTarget?.receiverConversationId,
            ]);
            if (!mounted.current || shell.projectId !== projectId || !shell.composerOpen
              || activePresentationKey !== presentationKey) return;
            const insertion = voiceInsertion.current;
            const merged = mergeVoiceText(shell.composerPrompt, transcript, insertion);
            setText(merged.text);
            voiceInsertion.current = undefined;
            setVoiceState('idle');
            window.requestAnimationFrame(() => {
              const editor = textareaRef.current;
              if (!editor?.isConnected) return;
              editor.focus({ preventScroll: true });
              editor.setSelectionRange(merged.caret, merged.caret);
            });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setVoiceState('idle');
            setVoiceError(error instanceof Error ? error.message : '语音转写失败');
          })
          .finally(() => { if (voiceAbort.current === controller) voiceAbort.current = null; });
      },
      onEnd: () => setVoiceState((current) => current === 'recording' ? 'idle' : current),
      onError: (code) => {
        setVoiceState('idle');
        setVoiceError(code === 'not-allowed' ? '麦克风权限未开放' : '无法启动录音');
      },
    });
    if (handle === null) {
      setVoiceError('当前浏览器不支持录音');
      return;
    }
    voiceHandle.current = handle;
    void handle.start();
  };

  const referenceItems = draftRefs.map((ref) => ({
    key: draftReferenceKey(ref),
    versionLabel: ref.revisionId ? `版本 ${ref.revisionId.slice(0, 8)}` : undefined,
    unavailableReason: isContinuation ? draftReferenceUnavailableReason(ref, 'continue') : runReferenceUnavailableReason(ref),
    onOpen: ['artifact','artifactView','view'].includes(ref.entityType) ? () => { void inspectReference(ref, referenceLabel(ref)); } : undefined,
    // Carry payload keeps exact identity minimal; use its live bound title for display.
    label: referenceLabel(ref.displayLabel || ref.descriptor?.title ? ref
      : [...nodeBindings.values()].find((bound) => bound.entityType === ref.entityType && bound.entityId === ref.entityId) ?? ref),
    thumbnailSrc: (() => {
      const image = nodes.find((node) => node.type === 'image'
        && nodeBindings.get(node.id) !== undefined
        && sameDraftReference(snapshotDraftReference(nodeBindings.get(node.id)!), ref));
      return image === undefined ? undefined : referenceImageSource(image.data, canvasId ?? undefined);
    })(),
    onRemove: state === 'submitting' ? undefined
      : () => useLcosReferenceStore.getState().removeEntityFromDraft(ref),
  }));
  const content = (
    <LcosComposerView
      presentation={inline ? 'inline' : 'nearfield'}
      state={state === 'submitting' ? 'sending' : state === 'done' ? 'ready'
        : state === 'error' ? 'error'
        : (isContinuation ? continuationBlockedReason !== undefined : workspaceId === undefined || composerTarget?.receiverBlockedReason) ? 'blocked'
        : text.length === 0 ? 'empty' : 'editing'}
      targetId={composerTarget?.nodeId}
      identity={composerTarget?.receiverConversationId ? (
        <LcosReceiverIdentity projectId={projectId} conversationId={composerTarget.receiverConversationId} size={inline ? 28 : 25} />
      ) : undefined}
      title={isContinuation
        ? `继续「${composerTarget?.title ?? '当前会话'}」`
        : `围绕「${composerTarget?.title ?? '当前对象'}」工作`}
      references={referenceItems}
      continuationControls={isContinuation && composerTarget?.receiverConversationId ? (<>
        {retainedSend && <div data-lcos-pending-send role="status" className="rounded-lg p-2 text-xs">
          <strong>{retainedSend.phase === 'sending' ? '原消息正在发送' : '原消息结果尚未确认'}</strong>
          <p className="line-clamp-2 break-words">{retainedSend.input.text}</p>
          <span>当前草稿可以保留；重试只使用这条原消息及其原引用，不会新建任务。</span>
          <div className="flex gap-2 pt-1">
            <button type="button" data-lcos-retry-original-send disabled={retainedSend.phase === 'sending' || continuationIdentityBlockedReason !== undefined}
              title={continuationIdentityBlockedReason} onClick={() => { void submit(retainedSend.input); }}>重试原消息</button>
            <button type="button" data-lcos-inspect-original-send onClick={() => {
              useLcosShellStore.getState().openWindow('conversation', '核对会话记录', retainedSend.input.conversationId);
              continuation.retry();
            }}>核对记录</button>
          </div>
        </div>}
        <ConversationContinuationControls disabled={retainedSend !== undefined} projectId={projectId}
          conversationId={composerTarget.receiverConversationId}
          draftReferences={draftRefs} referenceItems={referenceItems}
          collaboration={collaboration} onSubmitted={() => continuation.retry()} />
      </>) : undefined}
      referencePicker={<>
        <LcosIconButton appearance="oreo" variant="secondary" className="lcos-composer-tool-hit"
          disabled={state === 'submitting' || voiceState !== 'idle'} aria-label="从装配区找材料"
          title="从装配区找材料（保留当前输入）" onClick={() => {
            rememberCaret();
            const receiver = composerTarget?.receiverConversationId;
            useLcosShellStore.getState().openAssembly(receiver ? { kind: 'conversation', id: receiver }
              : workspaceId ? { kind: 'workspace', id: workspaceId } : { kind: 'main' }, '装配', false, inputKey);
          }}><LcosNearfieldGlyph name="attach" /></LcosIconButton>
        <LcosIconButton appearance="oreo" variant="secondary" className="lcos-composer-tool-hit"
          disabled={!isVoiceInputSupported() || voiceState === 'transcribing' || state === 'submitting'}
          aria-label={voiceState === 'recording' ? '停止录音' : '语音输入'}
          aria-pressed={voiceState === 'recording'}
          title={voiceState === 'recording' ? '停止录音并转写' : voiceState === 'transcribing' ? '语音转写中…' : '录音后转写到草稿'}
          onPointerDown={() => {
            if (voiceState !== 'idle') return;
            const editor = textareaRef.current;
            voiceInsertion.current = editor !== null && document.activeElement === editor
              ? { start: editor.selectionStart, end: editor.selectionEnd }
              : undefined;
          }}
          onClick={toggleVoiceInput}>
          {voiceState === 'recording' ? '停止' : voiceState === 'transcribing' ? '转写中' : '语音'}
        </LcosIconButton>
        {picking && <ComposerReferencePicker listOnly open={referencePickerOpen} onOpenChange={setReferencePickerOpen}
          disabled={state === 'submitting'} onPicked={() => textareaRef.current?.focus()} />}
      </>}
      attachAction={{ label: picking ? '结束画布引用' : '从画布添加引用', pressed: picking,
        icon: <Plus size={18} aria-hidden />,
        disabled: state === 'submitting' || voiceState !== 'idle', onClick: () => {
          rememberCaret();
          setReferencePickerOpen(false);
          useLcosReferenceStore.getState().setReferencePickOwner(picking ? null : presentationKey);
          if (picking) textareaRef.current?.focus();
        } }}
      text={text}
      textareaRef={textareaRef}
      referenceSurfaceRef={referenceSurfaceRef}
      referenceDropActive={referenceDropActive}
      onSelect={rememberCaret}
      onTextChange={(e) => {
        setText(e.target.value);
        if (state === 'done' || state === 'error') setState('idle');
      }}
      onKeyDown={onKeyDown}
      onClose={onClose}
      canSubmit={canSubmit}
      submitTitle={isContinuation
        ? continuationBlockedReason ?? '继续当前会话（Cmd/Ctrl+Enter）'
        : workspaceId === undefined
          ? '现场未就绪（未解析到 workspace），暂不可提交'
          : runReferenceBlockedReason ?? composerTarget?.receiverBlockedReason ?? '提交（Cmd/Ctrl+Enter）'}
      onSubmit={() => void submit()}
      feedbackAction={!isContinuation && state === 'done' && createdRun?.projectId === projectId
        ? { label: '查看任务', onClick: () => useLcosShellStore.getState().openWindow('run-review', '任务', createdRun.runId) }
        : isContinuation && continuationBlockedReason ? (
        continuation.error
          ? { label: '重试读取', onClick: continuation.retry }
          : composerTarget?.receiverConversationId && (continuationBlockedReason === '当前会话需要先连接或恢复'
            || continuationBlockedReason === '原消息提交结果未确认，请先在会话窗口核对原消息')
            ? { label: '查看会话连接', onClick: () => useLcosShellStore.getState().openWindow(
              'conversation', composerTarget.title, composerTarget.receiverConversationId,
            ) }
            : undefined
      ) : undefined}
      feedback={
        (isContinuation ? continuationBlockedReason !== undefined : workspaceId === undefined || composerTarget?.receiverBlockedReason)
          || runReferenceBlockedReason || picking || voiceError !== null || voiceState !== 'idle' || state === 'submitting' || (state === 'done' && receipt) || state === 'error'
          ? (
            <>
              {picking && <div role="status" data-lcos-reference-pick-hint>点选画布对象 · 再点取消引用 · Esc 结束</div>}
              {voiceState === 'recording' && <div role="status">录音中 · 再点“停止”完成转写</div>}
              {voiceState === 'transcribing' && <div role="status">语音转写中…</div>}
              {voiceError !== null && <div role="alert" data-feedback-tone="error">语音输入失败 · {voiceError}（草稿未改动）</div>}
              {!isContinuation && workspaceId === undefined && (
                <div data-lcos-composer-blocked data-feedback-tone="error">
                  现场未就绪（未解析到 workspace），暂不可提交
                </div>
              )}
              {isContinuation && continuationBlockedReason && (
                <div data-lcos-composer-continuation-blocked data-feedback-tone="error">
                  {continuationBlockedReason}
                </div>
              )}
              {!isContinuation && composerTarget?.receiverBlockedReason && (
                <div data-lcos-composer-receiver-blocked data-feedback-tone="error">
                  {composerTarget.receiverBlockedReason}
                </div>
              )}
              {runReferenceBlockedReason && <div role="status" data-lcos-composer-reference-blocked data-feedback-tone="error">
                {runReferenceBlockedReason}
              </div>}
              {state === 'submitting' && <div data-feedback-tone="loading">提交中…</div>}
              {state === 'done' && receipt && <div data-feedback-tone="normal">{receipt}</div>}
              {state === 'error' && (
                <div data-feedback-tone="error" role="alert">
                  {retainedSend ? '原消息待核对' : '提交失败'} · {errorDetail}（草稿已保留）
                </div>
              )}
            </>
          ) : null
      }
    />
  );

  return inline ? content : anchor ? (
    <CanvasFloatingPopover anchor={anchor} open={open} side="top" offset={10}>
      <ScaleIn initialScale={1}>{content}</ScaleIn>
    </CanvasFloatingPopover>
  ) : null;
}
