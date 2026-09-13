// LcosProjectLauncherPage — LCOS 项目启动页（Figma launcher 5388:3652；统一 SurfaceFeedback 5391:357）。
// 真实 Core route：GET/POST /projects；创建/打开走 POST intent create/open，回执翻译后进入项目。
// 禁止 mock 项目列表、禁止把打开失败伪装成功；reload 重读列表、已创建不重复创建。

import { HttpError } from '@local-creative-os/web-gen2';
import { FolderPlus, FolderOpen, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';


import { Button } from '@/components/Common/Button';
import { Input } from '@/components/Common/Input';

import { createLcosCoreSession } from './lcosCoreClient';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosGlassStyle, lcosHitArea, lcosTokens } from '../ui/lcosTokens';

import type { ProjectListItem } from '@local-creative-os/web-gen2';


type LauncherStatus = 'loading' | 'ready' | 'offline' | 'error';
type OpenDialogKind = 'create' | 'open' | null;

interface ProjectDraft {
  name: string;
  parentPath: string;
  directoryName: string;
}

interface OpenDraft {
  name: string;
  rootPath: string;
}

export function LcosProjectLauncherPage(): React.JSX.Element {
  const navigate = useNavigate();
  const session = useMemo(() => createLcosCoreSession(), []);
  const [projects, setProjects] = useState<readonly ProjectListItem[]>([]);
  const [status, setStatus] = useState<LauncherStatus>('loading');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recent' | 'all'>('recent');
  const [dialog, setDialog] = useState<OpenDialogKind>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [createDraft, setCreateDraft] = useState<ProjectDraft>({
    name: '',
    parentPath: '',
    directoryName: '',
  });
  const [openDraft, setOpenDraft] = useState<OpenDraft>({ name: '', rootPath: '' });

  const load = async (): Promise<void> => {
    try {
      const list = await session.projects.listProjects();
      setProjects(list);
      setStatus('ready');
    } catch (error) {
      if (error instanceof HttpError && (error.status === 0 || error.code === 'network')) {
        setStatus('offline');
      } else {
        setStatus('error');
      }
      setStatusDetail(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q === '' ? projects : projects.filter((p) => (p.name ?? '').toLowerCase().includes(q));
    if (tab === 'recent') {
      return [...matches].sort((a, b) => {
        const at = a.lastOpenedAt ?? '';
        const bt = b.lastOpenedAt ?? '';
        return bt.localeCompare(at);
      });
    }
    return [...matches].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }, [projects, query, tab]);

  const openProject = (id: string): void => {
    setOpeningId(id);
    navigate(`/projects/${encodeURIComponent(id)}/main`);
  };

  const submitCreate = async (): Promise<void> => {
    setSubmitError(undefined);
    if (!createDraft.name.trim() || !createDraft.parentPath.trim() || !createDraft.directoryName.trim()) {
      setSubmitError('请填写项目名称、父目录与目录名。');
      return;
    }
    setSubmitting(true);
    try {
      const receipt = await session.projects.createProject({
        name: createDraft.name.trim(),
        intent: 'create',
        parentPath: createDraft.parentPath.trim(),
        directoryName: createDraft.directoryName.trim(),
      });
      setDialog(null);
      await load();
      navigate(`/projects/${encodeURIComponent(receipt.id)}/main`);
    } catch (error) {
      const message = error instanceof HttpError ? error.message : String(error);
      setSubmitError(`创建失败 · ${message}`);
      // 保留已输入路径（Figma recovery 语义）
    } finally {
      setSubmitting(false);
    }
  };

  const submitOpen = async (): Promise<void> => {
    setSubmitError(undefined);
    if (!openDraft.name.trim() || !openDraft.rootPath.trim()) {
      setSubmitError('请填写项目名称与现有目录路径。');
      return;
    }
    setSubmitting(true);
    try {
      const receipt = await session.projects.createProject({
        name: openDraft.name.trim(),
        intent: 'open',
        rootPath: openDraft.rootPath.trim(),
      });
      setDialog(null);
      await load();
      navigate(`/projects/${encodeURIComponent(receipt.id)}/main`);
    } catch (error) {
      const message = error instanceof HttpError ? error.message : String(error);
      setSubmitError(`打开失败 · ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const coverTone = (seed: string, index: number): string => {
    const tones = ['linear-gradient(135deg,#E8EFE7,#F2F6F0)', 'linear-gradient(135deg,#E4EDF2,#EEF4F6)', 'linear-gradient(135deg,#F2ECE4,#F7F2EA)'];
    return tones[(seed.length + index) % tones.length];
  };

  return (
    <div
      data-lcos-launcher
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: lcosTokens.color.surface, color: lcosTokens.color.text }}
    >
      {/* 品牌 + 标题区 */}
      <header className="flex items-start justify-between px-12 pt-8">
        <div className="flex flex-col gap-7">
          <span className="text-lg font-semibold tracking-wide" style={{ fontSize: 18 }}>LCOS</span>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-semibold" style={{ fontSize: lcosTokens.fontSize.hero }}>
              项目
            </h1>
            <p className="text-sm" style={{ color: lcosTokens.color.muted }}>
              继续上一次的创作现场。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('recent')}
              className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
              style={
                tab === 'recent'
                  ? { background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }
                  : { color: lcosTokens.color.muted, minHeight: 28 }
              }
            >
              最近
            </button>
            <button
              type="button"
              onClick={() => setTab('all')}
              className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
              style={tab === 'all' ? { background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse } : { color: lcosTokens.color.muted, minHeight: 28 }}
            >
              全部
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-4">
          <Button
            variant="solid"
            shape="pill"
            size="lg"
            style={{ minHeight: lcosHitArea.min }}
            onClick={() => { setSubmitError(undefined); setDialog('create'); }}
          >
            <FolderPlus className="mr-1.5 h-4 w-4" />
            新建项目
          </Button>
          <Button
            variant="outline"
            shape="pill"
            size="lg"
            style={{ minHeight: lcosHitArea.min, minWidth: 188 }}
            onClick={() => { setSubmitError(undefined); setDialog('open'); }}
          >
            <FolderOpen className="mr-1.5 h-4 w-4" />
            打开已有项目
          </Button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="min-h-0 flex-1 overflow-y-auto px-12 pt-6">
        {status === 'loading' && (
          <div className="py-16">
            <LcosSurfaceFeedback presentation="loading" message="正在读取项目…" />
          </div>
        )}
        {status === 'offline' && (
          <div className="py-16">
            <LcosSurfaceFeedback
              presentation="error"
              message={`Local Core 未连接${statusDetail ? `（${statusDetail}）` : ''}`}
              onAction={() => { setStatus('loading'); void load(); }}
              actionLabel="重试"
            />
          </div>
        )}
        {status === 'error' && (
          <div className="py-16">
            <LcosSurfaceFeedback
              presentation="error"
              message={`项目列表读取失败${statusDetail ? `（${statusDetail}）` : ''}`}
              onAction={() => { setStatus('loading'); void load(); }}
              actionLabel="重试"
            />
          </div>
        )}
        {status === 'ready' && (
          <div className="flex flex-col gap-5 pb-16">
            <label className="flex max-w-md items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: lcosTokens.color.raised }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="名称或关键词"
                aria-label="搜索项目"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: lcosTokens.color.text }}
              />
              {query !== '' && (
                <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                  <X className="h-4 w-4" style={{ color: lcosTokens.color.muted }} />
                </button>
              )}
            </label>

            {filtered.length === 0 ? (
              <div className="py-16">
                <LcosSurfaceFeedback
                  presentation="empty"
                  message={query ? '没有匹配的项目' : '还没有项目 · 新建或打开一个创作现场'}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3" style={{ rowGap: 28 }}>
                {filtered.map((project, index) => (
                  <button
                    key={project.id}
                    type="button"
                    disabled={openingId === project.id}
                    onClick={() => openProject(project.id)}
                    className="group flex flex-col items-start gap-2 text-left outline-none transition-transform hover:-translate-y-0.5"
                    style={{ minWidth: 260, minHeight: 174 }}
                  >
                    <div
                      className="flex aspect-[16/10] w-full items-end justify-end overflow-hidden rounded-xl p-3 transition-shadow"
                      style={{ background: coverTone(project.rootPath, index), boxShadow: lcosTokens.shadow.default }}
                    >
                      <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-medium" style={{ color: lcosTokens.color.muted }}>
                        项目
                      </span>
                    </div>
                    <span className="text-sm font-semibold" style={{ fontSize: lcosTokens.fontSize.md }}>
                      {project.name}
                    </span>
                    <span className="text-xs truncate max-w-full" style={{ color: lcosTokens.color.muted }}>
                      {project.rootPath}
                      {project.lastOpenedAt ? ` · ${new Date(project.lastOpenedAt).toLocaleDateString('zh-CN')}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between px-12 pb-6">
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          项目保存在你自己的电脑上 — Local Core 是唯一真相源
        </span>
      </footer>

      {/* 创建 / 打开对话框（真实 Core route；保留已输入路径） */}
      {dialog !== null && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/20">
          <button
            type="button"
            aria-label="关闭对话框"
            tabIndex={-1}
            className="absolute inset-0"
            style={{ background: 'transparent', cursor: 'default' }}
            onClick={() => setDialog(null)}
          />
          <div role="dialog" aria-modal="true" aria-label={dialog === 'create' ? '新建项目' : '打开已有项目'} className="relative z-10 w-[420px] p-6" style={lcosGlassStyle}>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{dialog === 'create' ? '新建项目' : '打开已有项目'}</h2>
              <button type="button" onClick={() => setDialog(null)} aria-label="关闭" className="rounded-full p-1.5" style={{ minHeight: 32, minWidth: 32 }}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {dialog === 'create' ? (
              <div className="flex flex-col gap-3">
                <Field label="项目名称" value={createDraft.name} onChange={(v) => setCreateDraft({ ...createDraft, name: v })} placeholder="例如：山野 · 品牌探索" autoFocus />
                <Field label="父目录路径" value={createDraft.parentPath} onChange={(v) => setCreateDraft({ ...createDraft, parentPath: v })} placeholder="例如：D:\Projects" />
                <Field label="目录名" value={createDraft.directoryName} onChange={(v) => setCreateDraft({ ...createDraft, directoryName: v })} placeholder="例如：mountain-brand" />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Field label="项目名称" value={openDraft.name} onChange={(v) => setOpenDraft({ ...openDraft, name: v })} placeholder="例如：山野 · 品牌探索" autoFocus />
                <Field label="已有目录路径（rootPath）" value={openDraft.rootPath} onChange={(v) => setOpenDraft({ ...openDraft, rootPath: v })} placeholder="例如：D:\Projects\mountain-brand" />
              </div>
            )}

            {submitError && (
              <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'rgba(194,91,78,0.08)', color: lcosTokens.color.danger }}>
                <span className="text-xs">{submitError}</span>
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" shape="pill" size="lg" onClick={() => setDialog(null)} style={{ minHeight: lcosHitArea.min }}>
                取消
              </Button>
              <Button
                variant="solid"
                shape="pill"
                size="lg"
                disabled={submitting}
                onClick={dialog === 'create' ? () => void submitCreate() : () => void submitOpen()}
                style={{ minHeight: lcosHitArea.min }}
              >
                {submitting ? (dialog === 'create' ? '创建中…' : '打开中…') : dialog === 'create' ? '创建并进入' : '打开并进入'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: lcosTokens.color.muted }}>{props.label}</span>
      <Input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        className="w-full"
      />
    </label>
  );
}
