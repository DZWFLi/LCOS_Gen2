// LCOS's existing-node/revision adapter. Editing, formatting, selection and
// Markdown serialization are the existing Milkdown/ProseMirror implementation.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { CanvasTextSnapshot, CanvasTextWrite } from '@local-creative-os/web-gen2';
import { MilkdownEditor, markdownEquals, type MilkdownInstance } from '@/components/Milkdown';
import { MilkdownFloatingToolbar } from '@/components/Milkdown/MilkdownFloatingToolbar';
import { Button } from '@/components/Common/Button';
import { stripMarkdown } from '@huabu/shared/canvas-engine';
import { FLOATING_CHROME_SELECTOR } from '@/components/Common/floatingChrome';
import useCanvasStore from '@/store/canvasStore';
import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { DocumentSourceView } from '../ui/source/DocumentSourceView';
import { TextSourceView } from '../ui/source/TextSourceView';
import { useLcosDensity } from './useLcosDensity';
import { layoutNodeLocked } from '../navigation/selectionLayout';
import { canvasTextReplyMatches, canvasTextCarrierMatches } from './canvasTextSave';
import { NodeColorPinMarkers } from './NodeColorPinMarkers';
import { NodeReferenceMarker } from './NodeReferenceMarker';
import './canvas-text-editor.css';

interface DraftRecord { body: string; base: CanvasTextSnapshot | null; pending?: CanvasTextWrite }
// Only unfinished edits. Not a second body truth; saved drafts are removed.
// Survives leaving and returning to a scene in this page, not browser restart.
const unfinished = new Map<string, DraftRecord>();

export function LcosCanvasTextBody(input: CanvasNodeBodySlotInput): JSX.Element {
  const projectId = useLcosReferenceStore((s) => s.projectId);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const ref = useLcosReferenceStore((s) => s.nodeEntityRefs.get(input.nodeId));
  const locked = useCanvasStore((s) => layoutNodeLocked(s.nodes, input.nodeId));
  const requested = useCanvasStore((s) => s.pendingInlineEditNodeId === input.nodeId);
  const session = useMemo(() => createLcosCoreSession(), []);
  const key = JSON.stringify([projectId, canvasId, input.nodeId]);
  const nativeBody = typeof input.data?.content === 'string' ? input.data.content : '';
  const cached = unfinished.get(key);
  const [body, setBody] = useState(cached?.body ?? nativeBody);
  const [base, setBase] = useState<CanvasTextSnapshot | null>(cached?.base ?? null);
  const [editing, setEditing] = useState(!!cached || requested);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'unknown' | 'error'>('loading');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<MilkdownInstance | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const [editorError, setEditorError] = useState('');
  const [editorAttempt, setEditorAttempt] = useState(0);
  const readController = useRef<AbortController | null>(null);
  const loadedKey = useRef<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ body, base, key, state, editing });
  latest.current = { body, base, key, state, editing };
  const pending = useRef<CanvasTextWrite | undefined>(cached?.pending);
  const active = useRef(true);
  const presentation = useLcosNodePresentation();
  const density = useLcosDensity(editing ? 'editing' : undefined);
  const currentRevisionId = ref?.descriptor?.currentRevisionId;
  const address = useMemo(() => ({ canvasId: canvasId ?? '', spatialId: input.nodeId }), [canvasId, input.nodeId]);
  const current = useCallback(() => active.current && useCanvasStore.getState().canvasId === canvasId
    && useLcosReferenceStore.getState().projectId === projectId
    && useCanvasStore.getState().nodes.some((node) => node.id === input.nodeId), [projectId, canvasId, input.nodeId]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  useEffect(() => {
    if (!projectId || !canvasId) return;
    const controller = new AbortController();
    readController.current = controller;
    pending.current = unfinished.get(key)?.pending;
    // A metadata refresh must not unmount the active rich editor or discard its
    // caret. An in-flight save keeps its own state; the read may only confirm it.
    if (!(latest.current.key === key && latest.current.editing && loadedKey.current === key)
      && !pending.current) setState('loading');
    void session.artifacts.readCanvasText(projectId, address, controller.signal).then((value) => {
      if (controller.signal.aborted || !current()) return;
      loadedKey.current = key;
      // The user may have typed since this read started. Inspect the current
      // draft, not the snapshot from the beginning of a network request.
      const savedDraft = unfinished.get(key);
      if (savedDraft) {
        if (savedDraft.pending && value && canvasTextReplyMatches(projectId, savedDraft.pending, value)) {
          confirm(savedDraft.pending, value); return;
        } else if (savedDraft.pending) {
          setBody(savedDraft.body); setBase(savedDraft.base); setState('unknown');
          setError('原保存尚未确认。保留原稿，不会以新内容重发。'); return;
        } else if (savedDraft.base?.revisionId !== value?.revisionId) {
          setBody(savedDraft.body); setBase(savedDraft.base); setState('error');
          setError('正文已在别处更新，草稿保留。请对照当前版本后再处理。'); return;
        } else { setBody(savedDraft.body); setBase(value); }
      } else { setBase(value); setBody(value?.body ?? nativeBody); }
      setState('ready'); setError('');
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || !current()) return;
      setState('error'); setError(reason instanceof Error ? reason.message : '正文未能读取，未开始编辑。');
    });
    return () => { controller.abort(); if (readController.current === controller) readController.current = null; };
  }, [key, loadTick, projectId, canvasId, address, current, session, currentRevisionId, nativeBody]);

  useEffect(() => {
    setEditing(unfinished.has(key) || useCanvasStore.getState().pendingInlineEditNodeId === input.nodeId);
    setEditorError('');
  }, [key, input.nodeId]);

  useEffect(() => {
    if (!requested) return;
    setEditing(true);
    useCanvasStore.getState().consumeInlineEditRequest(input.nodeId);
  }, [requested, input.nodeId]);
  const readyEditor = useCallback((instance: MilkdownInstance | null) => {
    setEditor(instance);
    if (instance && current() && latest.current.key === key && latest.current.editing
      && latest.current.state === 'ready' && !layoutNodeLocked(useCanvasStore.getState().nodes, input.nodeId)) instance.focus();
  }, [current, key, input.nodeId]);
  const failedEditor = useCallback((error: Error) => {
    if (!current() || latest.current.key !== key) return;
    setEditorError(error.message);
    const draft = latest.current;
    unfinished.set(key, { body: draft.body, base: draft.base, ...(pending.current ? { pending: pending.current } : {}) });
  }, [current, key]);

  const remember = (value: string) => {
    latest.current = { ...latest.current, body: value };
    setBody(value);
    unfinished.set(key, { body: value, base: latest.current.base, ...(pending.current ? { pending: pending.current } : {}) });
  };
  const confirm = (sent: CanvasTextWrite, value: CanvasTextSnapshot) => {
    // A previous read/retry must not confirm again after the original save
    // settled and the user started another draft. Identity is the in-flight
    // immutable payload, not a clock or a global suppression window.
    if (pending.current !== sent) return;
    if (!projectId || !canvasTextReplyMatches(projectId, sent, value)) throw new Error('保存回执与原节点或正文不一致。');
    // Persisted content survives leaving the scene; late UI responses do not
    // create/move a native node or touch the new scene's draft.
    if (current() && !canvasTextCarrierMatches(useLcosReferenceStore.getState().nodeEntityRefs.get(input.nodeId), value)) {
      setState('unknown'); setError('正文已保存，但当前节点的材料身份已变化；没有覆盖它。'); return;
    }
    if (unfinished.get(key)?.pending === sent) unfinished.delete(key);
    pending.current = undefined;
    readController.current?.abort();
    if (!current()) return;
    setBase(value); setBody(value.body); setState('ready'); setError(''); setEditing(false);
    useLcosReferenceStore.getState().registerNodeEntity(input.nodeId, { entityType: 'artifact', entityId: value.artifactId });
    useLcosReferenceStore.getState().requestNodeBindingRefresh();
  };
  const save = async () => {
    if (!projectId || !canvasId || !current() || locked || editorError || latest.current.state !== 'ready' || pending.current) return;
    const draft = latest.current;
    if (draft.base && markdownEquals(draft.body, draft.base.body)) { setEditing(false); unfinished.delete(key); return; }
    const sent: CanvasTextWrite = { ...address, body: draft.body, expectedRevisionId: draft.base?.revisionId ?? null,
      ...(draft.base ? { artifactId: draft.base.artifactId } : {}) };
    readController.current?.abort();
    pending.current = sent; unfinished.set(key, { body: sent.body, base: draft.base, pending: sent });
    setState('saving');
    let dispatched = false;
    try {
      // Structure is native; the existing node must be saved before claiming it.
      if (!draft.base && !await useCanvasStore.getState().saveCanvas()) throw new Error('画布节点尚未保存，正文仍保留在草稿。');
      if (!current()) { pending.current = undefined; unfinished.set(key, { body: sent.body, base: draft.base }); return; }
      if (layoutNodeLocked(useCanvasStore.getState().nodes, input.nodeId)) throw new Error('节点已锁定，未保存正文。');
      dispatched = true;
      const value = await session.artifacts.saveCanvasText(projectId, sent);
      confirm(sent, value);
    } catch (reason) {
      if (!current() || pending.current !== sent) return;
      if (!dispatched) { pending.current = undefined; unfinished.set(key, { body: sent.body, base: draft.base }); }
      setState(dispatched ? 'unknown' : 'error'); setError(reason instanceof Error ? reason.message : '保存结果未确认。');
      // Any failed write response may be a lost reply; do not silently retry.
    }
  };
  const verify = async () => {
    if (!projectId || !pending.current || !current()) return;
    const sent = pending.current;
    try {
      const value = await session.artifacts.readCanvasText(projectId, address);
      if (!current() || pending.current !== sent) return;
      if (value && canvasTextReplyMatches(projectId, sent, value)) { confirm(sent, value); return; }
      // A read cannot prove an in-flight request will never arrive; keep the
      // original payload and allow only an explicit idempotent retry of it.
      setError('当前正文尚未对应原保存。可重试原保存，不可换稿重发。');
    } catch (reason) { if (current() && pending.current === sent) setError(reason instanceof Error ? reason.message : '核对失败。'); }
  };
  const retryOriginal = async () => {
    if (!projectId || !pending.current || !current() || locked || latest.current.state === 'saving') return;
    const sent = pending.current; setState('saving');
    try { confirm(sent, await session.artifacts.saveCanvasText(projectId, sent)); }
    catch (reason) { if (current() && pending.current === sent) { setState('unknown'); setError(reason instanceof Error ? reason.message : '原保存未确认。'); } }
  };
  const discard = () => {
    if (pending.current || state === 'saving') return;
    if (!markdownEquals(body, base?.body ?? nativeBody) && !window.confirm('放弃尚未保存的正文修改？')) return;
    unfinished.delete(key); setBody(base?.body ?? nativeBody); setEditing(false); setLoadTick((n) => n + 1);
  };
  const title = stripMarkdown(base?.title ?? ref?.descriptor?.title ?? (typeof input.data?.label === 'string' ? input.data.label : '文本'));
  const markdownBody = ref?.descriptor?.artifactKind === 'markdown' || base !== null || input.nodeType === 'note';
  const visualProps = { family: markdownBody ? 'document' as const : 'text' as const, title, preview: body, density, zoom: presentation?.zoom,
    worldWidth: presentation?.worldWidth, worldHeight: presentation?.worldHeight };
  const busy = state === 'saving' || state === 'unknown';
  return <div className="lcos-inline-text h-full w-full" data-lcos-inline-text data-state={state}
    onDoubleClick={(event) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || useLcosReferenceStore.getState().referencePickOwner != null) return;
      if (state === 'ready' && !locked) setEditing(true);
    }}>
    {editing && (state !== 'loading' || loadedKey.current === key) ? <div className="lcos-inline-text-editor nodrag nopan nowheel" ref={surfaceRef}
      onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) discard(); }
        else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(); }
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && (event.currentTarget.contains(next) || next.closest(FLOATING_CHROME_SELECTOR))) return;
        // Explicit save is also available; error/unknown never submit on blur.
        if (latest.current.state === 'ready' && (!markdownEquals(latest.current.body, latest.current.base?.body ?? nativeBody)
          || !latest.current.base && latest.current.body.trim() !== '')) void save();
      }}>
      <MilkdownFloatingToolbar instance={editor} surfaceRef={surfaceRef} />
      <MilkdownEditor key={`${key}:${editorAttempt}`} markdown={body} onChange={remember} editable={state === 'ready' && !locked && !editorError}
        onReady={readyEditor} onError={failedEditor} placeholder="写下内容…" className="milkdown-note-preview" />
      {editorError && <div role="alert" data-floating-chrome>
        <span>编辑器未能载入，原稿仍保留：{editorError}</span>
        <Button size="sm" variant="ghost" onClick={() => { setEditorError(''); setEditorAttempt(n => n + 1); }}>重载编辑器</Button>
      </div>}
      <div className="lcos-inline-text-actions" data-floating-chrome>
        <Button size="sm" variant="ghost" onClick={() => void save()} disabled={state !== 'ready' || locked || !!editorError}>保存</Button>
        <Button size="sm" variant="ghost" onClick={discard} disabled={busy}>取消编辑</Button>
        <span role="status">{state === 'saving' ? '正在保存…' : 'Ctrl / ⌘ + Enter 保存'}</span>
      </div>
    </div> : markdownBody ? <DocumentSourceView {...visualProps} canonicalMarkdown={body} />
      : <TextSourceView {...visualProps} />}
    <NodeColorPinMarkers nodeId={input.nodeId} />
    <NodeReferenceMarker nodeId={input.nodeId} />
    {state === 'loading' && <span className="lcos-inline-text-status" role="status">读取正文…</span>}
    {(state === 'error' || state === 'unknown') && <div className="lcos-inline-text-status nodrag nopan" role="status" data-floating-chrome>
      <span>{error}</span>
      <Button size="sm" variant="ghost" onClick={() => state === 'unknown' ? void verify() : setLoadTick((n) => n + 1)}>{state === 'unknown' ? '核对原保存' : '重读正文'}</Button>
      {state === 'unknown' && <Button size="sm" variant="ghost" onClick={() => void retryOriginal()}>重试原保存</Button>}
      {state === 'error' && unfinished.has(key) && <Button size="sm" variant="ghost" onClick={discard}>放弃草稿并重读</Button>}
    </div>}
  </div>;
}
