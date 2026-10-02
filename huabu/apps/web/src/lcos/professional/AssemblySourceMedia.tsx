import { useCallback, useEffect, useRef, useState } from 'react';

import { LcosButton } from '../ui/primitives/LcosButton';
import { readAssemblyArtifactMedia } from './assemblyArtifactMedia';
import { AssemblyMaterialView } from '../ui/professional/AssemblyMaterialView';

import type { AssemblyMaterialViewProps } from '../ui/professional/AssemblyMaterialView';
import type { CoreArtifactClient, CoreCaptureSpaceClient, CoreResourceClient } from '@local-creative-os/web-gen2';

type Media = { readonly image?: Blob | string; readonly text?: string };
type Loader = (signal: AbortSignal) => Promise<Media>;

/** Visible-only transient preview. Canonical identities and content still belong to Core. */
function DeferredMedia({ load, ...props }: AssemblyMaterialViewProps & { readonly load: Loader }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [media, setMedia] = useState<{ readonly image?: string; readonly text?: string }>({});
  const [state, setState] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  useEffect(() => {
    if (!host.current) { return; }
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) { return; }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setMedia({}); setState('loading');
    void load(controller.signal).then((value) => {
      if (controller.signal.aborted) { return; }
      if (value.image instanceof Blob) { objectUrl = URL.createObjectURL(value.image); }
      const image = typeof value.image === 'string' ? value.image : objectUrl;
      setMedia({ ...(image === undefined ? {} : { image }),
        ...(value.text !== undefined ? { text: value.text } : {}) });
      setState('ready');
    }).catch(() => { if (!controller.signal.aborted) { setState('error'); } });
    return () => { controller.abort(); if (objectUrl) { URL.revokeObjectURL(objectUrl); } };
  }, [visible, load, attempt]);
  return <div ref={host} data-lcos-assembly-media-load={state}>
    <AssemblyMaterialView {...props} {...(media.image ? { previewUrl: media.image } : {})}
      {...(media.text === undefined ? {} : { excerpt: media.text.slice(0, 1200) })}
      feedback={state === 'loading' ? <span className="lcos-assembly-media-loading" role="status">正在读取…</span>
        : state === 'error' ? <LcosButton appearance="oreo" variant="ghost" className="lcos-assembly-media-retry" onClick={() => setAttempt((value) => value + 1)}>预览未读取 · 重试</LcosButton> : undefined} />
  </div>;
}

/** Same revision/FileRecord channel as ArtifactReaderBody. No guessed asset URL or fixture cover. */
export function AssemblyArtifactMedia({ client, projectId, artifactId, revisionId, ...props }: AssemblyMaterialViewProps & {
  readonly client: CoreArtifactClient; readonly projectId: string; readonly artifactId: string; readonly revisionId?: string;
}): React.JSX.Element {
  const load = useCallback(async (signal: AbortSignal): Promise<Media> => {
    const value = await readAssemblyArtifactMedia(client, projectId, artifactId, revisionId, signal);
    return value.kind === 'image' && value.blob !== undefined ? { image: value.blob }
      : value.kind === 'text' && value.text !== undefined ? { text: value.text } : {};
  }, [client, artifactId, projectId, revisionId]);
  return <DeferredMedia {...props} load={load} />;
}

export function AssemblyCaptureMedia({ client, captureId, ...props }: AssemblyMaterialViewProps & {
  readonly client: CoreCaptureSpaceClient; readonly captureId: string;
}): React.JSX.Element {
  const load = useCallback(async (signal: AbortSignal): Promise<Media> => {
    const preview = await client.preview(captureId, signal);
    return { ...(preview.type === 'image' && preview.dataUrl ? { image: preview.dataUrl } : {}),
      ...(preview.type === 'text' && preview.text !== undefined ? { text: preview.text } : {}) };
  }, [client, captureId]);
  return <DeferredMedia {...props} load={load} />;
}

export function AssemblyResourceMedia({ client, projectId, resourceId, ...props }: AssemblyMaterialViewProps & {
  readonly client: CoreResourceClient; readonly projectId: string; readonly resourceId: string;
}): React.JSX.Element {
  const load = useCallback(async (signal: AbortSignal): Promise<Media> => {
    const descriptor = await client.descriptor(projectId, resourceId, signal);
    return descriptor.understanding.summary ? { text: descriptor.understanding.summary } : {};
  }, [client, projectId, resourceId]);
  return <DeferredMedia {...props} load={load} />;
}
