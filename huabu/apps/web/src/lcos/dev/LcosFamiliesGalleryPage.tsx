// LCOS 组件族 dev-only gallery（R1 第 4 步）。
// 目的：把 Figma 每族的**全部 variant**（含 disabled/loading/error/degraded/selected/focus）
// 放在同一个可浏览页面里，作为「设计系统 → 代码组件」的唯一对照面。
// 只在 dev 生效：路由由 App.tsx 的 `import.meta.env.DEV` 分支挂载（同 /playground/*）。
//
// 这里不制造产品状态：所有数据都是字面样例；真实状态由各生产 caller 提供。

import {
  BarChart3,
  FileText,
  Home,
  Layers,
  ListTree,
  PanelsTopLeft,
  PlusCircle,
  Search,
} from 'lucide-react';
import { useState } from 'react';

import { LcosProjectShell } from '../shell/LcosProjectShell';
import {
  LcosCollectionSurface,
  LcosNavigatorIslandView,
  LcosPortalPreview,
  LcosRailwayView,
  LcosTaskCard,
  LcosWindowChrome,
  type LcosCollectionOrganize,
  type LcosCollectionRendition,
  type LcosNavigatorIslandState,
  type LcosPortalPreviewState,
  type LcosTaskCardState,
  type LcosWindowLayout,
} from '../ui/families';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';

const NAV_STATES: readonly LcosNavigatorIslandState[] = [
  '静息',
  '彩色标',
  '搜索',
  'hover',
  'pressed',
  'focus',
  'disabled',
  'loading',
  'error',
  'degraded',
  'selected',
];

const FEEDBACK_PRESENTATIONS = [
  'loading',
  'empty',
  'normal',
  'focus',
  'disabled',
  'error',
  'recovery',
] as const;

const TASK_STATES: readonly LcosTaskCardState[] = [
  '静息',
  '悬停',
  '预览',
  '已选目标',
  '草稿中',
  '不可用',
  '键盘焦点',
];

const PORTAL_STATES: readonly LcosPortalPreviewState[] = [
  '可预览',
  '加载中',
  '旧缓存',
  '部分预览',
  '预览失败',
  '目标缺失',
];

const WINDOW_LAYOUTS: readonly LcosWindowLayout[] = ['浮动', '停靠', '分组'];

const COLLECTION_GRID: readonly [LcosCollectionOrganize, LcosCollectionRendition][] = [
  ['事情', '总览'],
  ['事情', '主画布'],
  ['事情', '装配'],
  ['时间', '总览'],
  ['时间', '主画布'],
  ['时间', '装配'],
];

const RAIL_ICONS = { main: PanelsTopLeft, context: Layers, workflow: ListTree } as const;

function Section({
  id,
  figma,
  note,
  children,
}: {
  readonly id: string;
  readonly figma: string;
  readonly note?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section data-lcos-gallery-section={id} className="flex flex-col gap-3 border-t pt-6" style={{ borderColor: 'var(--lcos-color-border-subtle)' }}>
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">{id}</h2>
        <code className="text-[11px] opacity-60">{figma}</code>
        {note && <span className="text-[11px] opacity-60">{note}</span>}
      </header>
      {children}
    </section>
  );
}

export default function LcosFamiliesGalleryPage(): React.JSX.Element {
  const [dark, setDark] = useState(false);

  const applyTheme = (next: boolean): void => {
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  return (
    <div
      data-lcos-gallery
      data-lcos-gallery-theme={dark ? 'dark' : 'light'}
      className="min-h-screen w-full"
      style={{ background: 'var(--gen2-canvas)', color: 'var(--gen2-text)' }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">LCOS 组件族 gallery（dev-only）</h1>
            <p className="text-xs opacity-70">
              共享族 = ProjectShell / NavigatorIsland / Railway / ProfessionalWindowChrome /
              SurfaceFeedback / Collection / TaskCard / Portal；变体轴取值与 Figma 同名。
              生产 caller 见 docs/construction/FIGMA_SOURCE_LEDGER.md。
            </p>
          </div>
          <button
            type="button"
            data-lcos-gallery-theme-toggle
            onClick={() => applyTheme(!dark)}
            className="rounded-full px-4 text-xs font-medium"
            style={{
              minHeight: 44,
              background: 'var(--lcos-color-bg-inverse)',
              color: 'var(--lcos-color-text-on-inverse)',
            }}
          >
            {dark ? '切到 Oreo 浅色' : '切到 Dark Oreo 深色'}
          </button>
        </header>

        <Section id="NavigatorIsland" figma="统一 / NavigatorIsland 5384:367 · 11 状态" note="生产 caller：lcos/navigation/LcosNavigatorIsland.tsx（可达 静息/搜索/loading/error）">
          <div className="flex flex-wrap items-center gap-4">
            {NAV_STATES.map((state) => (
              <div key={state} className="flex flex-col items-center gap-2">
                <LcosNavigatorIslandView
                  state={state}
                  pins={
                    state === '彩色标' || state === '搜索'
                      ? [
                          { id: 'p-violet', tone: 'violet', label: '紫色组' },
                          { id: 'p-teal', tone: 'teal', label: '青色组' },
                          { id: 'p-amber', tone: 'amber', label: '琥珀组' },
                        ]
                      : []
                  }
                  query={state === '搜索' ? '创意简报' : ''}
                  message={state === 'error' ? '搜索失败 · 请重试' : undefined}
                />
                <span className="text-[10px] opacity-60">{state}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="Railway" figma="统一 / Railway 5385:283 · 目的地 1 / 4" note="生产 caller：lcos/shell/LcosRailway.tsx（三现场）">
          <div className="flex flex-wrap items-start gap-8">
            <div className="flex flex-col items-center gap-2">
              <LcosRailwayView
                items={[{ key: 'main', label: '主现场', icon: RAIL_ICONS.main, selected: true }]}
              />
              <span className="text-[10px] opacity-60">目的地=1（52×52）</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <LcosRailwayView
                items={[
                  { key: 'main', label: '主现场', icon: RAIL_ICONS.main, selected: true },
                  { key: 'context', label: '上下文现场', icon: RAIL_ICONS.context },
                  { key: 'workflow', label: '工作流现场', icon: RAIL_ICONS.workflow },
                  { key: 'off', label: '不可用目的地', icon: BarChart3, disabled: true },
                ]}
                footer="+1 个长期现场"
              />
              <span className="text-[10px] opacity-60">目的地=4（52×178）</span>
            </div>
          </div>
        </Section>

        <Section id="ProfessionalWindowChrome" figma="统一 / ProfessionalWindowChrome 5387:331 · 布局 浮动/停靠/分组" note="生产 caller：lcos/professional/ProfessionalWindowStage.tsx">
          <div className="flex flex-col gap-4">
            {WINDOW_LAYOUTS.map((layout) => (
              <div
                key={layout}
                className="overflow-hidden rounded-xl"
                style={{ border: '1px solid var(--lcos-color-border-subtle)' }}
              >
                <LcosWindowChrome
                  layout={layout}
                  title="阅读 · 创意简报"
                  tabs={[
                    { key: 'reader', label: '阅读 · 创意简报', selected: true },
                    { key: 'assembly', label: 'Assembly' },
                    { key: 'conversation', label: '会话窗口' },
                  ]}
                  actions={
                    <button type="button" data-lcos-window-icon-button aria-label="更多（样例）">
                      <Search className="h-4 w-4" />
                    </button>
                  }
                />
                <div className="px-6 py-4 text-[11px] opacity-60">布局={layout}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="SurfaceFeedback" figma="统一 / SurfaceFeedback 5391:357 · 7 呈现" note="生产 caller：多处（Assembly/Atlas/Workflow 的 loading/empty/error）">
          <div className="flex flex-wrap items-center gap-4">
            {FEEDBACK_PRESENTATIONS.map((presentation) => (
              <div key={presentation} className="flex flex-col items-center gap-2">
                <LcosSurfaceFeedback presentation={presentation} />
                <span className="text-[10px] opacity-60">{presentation}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="Collection" figma="集合 / 上下文跨视图 5333:96 · 组织×呈现；工作流跨视图 5334:46" note="生产 caller：lcos/surfaces/context/ContextAtlasStage.tsx（目前只到 总览）">
          <div className="flex flex-wrap gap-8">
            {COLLECTION_GRID.map(([organize, rendition]) => (
              <LcosCollectionSurface
                key={`${organize}-${rendition}`}
                organize={organize}
                rendition={rendition}
                title="8 月 21 日后需求"
                meta={`组织=${organize} · 呈现=${rendition}`}
              />
            ))}
            {(['工作流现场', '主画布', '装配'] as const).map((rendition) => (
              <LcosCollectionSurface
                key={`wf-${rendition}`}
                organize="事情"
                rendition={rendition}
                title="工作流集合"
                meta={`工作流跨视图 · 呈现=${rendition}`}
              />
            ))}
          </div>
        </Section>

        <Section id="TaskCard" figma="工作流 / 取用卡 5335:110 · 7 状态" note="生产 caller：lcos/surfaces/workflow/WorkflowCardPool.tsx（可达 静息/草稿中/不可用）">
          <div className="flex flex-wrap gap-6">
            {TASK_STATES.map((state) => (
              <LcosTaskCard
                key={state}
                state={state}
                title="创意简报 v3"
                meta={`状态=${state}`}
                footer={
                  <button type="button" className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--gen2-text)' }}>
                    <PlusCircle className="h-3 w-3" aria-hidden /> 取用
                  </button>
                }
              >
                <span className="text-[10px] opacity-60">
                  <FileText className="mr-1 inline h-3 w-3" aria-hidden />
                  材料
                </span>
              </LcosTaskCard>
            ))}
          </div>
        </Section>

        <Section id="Portal" figma="产品 Portal / 目标预览状态 5348:1151 · 6 状态" note="生产 caller：lcos/professional/PortalPreviewBody.tsx（可达 可预览/目标缺失）">
          <div className="flex flex-wrap gap-6">
            {PORTAL_STATES.map((state) => (
              <LcosPortalPreview
                key={state}
                state={state}
                title="入口目标预览"
                detail={`状态=${state}`}
              />
            ))}
          </div>
        </Section>

        <Section
          id="ProjectShell"
          figma="统一 / ProjectShell 5386:436 · 现场 Main/Context/Workflow"
          note="生产 caller：lcos/shell/LcosProjectShell.tsx（本 gallery 用 loading 壳，避免在无项目上下文处伪造现场数据）"
        >
          <div className="flex flex-wrap gap-6">
            {(['main', 'context', 'workflow'] as const).map((variant) => (
              <div
                key={variant}
                className="h-[260px] w-[420px] overflow-hidden rounded-xl"
                style={{ border: '1px solid var(--lcos-color-border-subtle)' }}
              >
                <LcosProjectShell
                  projectId="gallery"
                  projectName={`现场=${variant}`}
                  surface={variant}
                  workspaces={[]}
                  canvasBySurface={{}}
                  surfaceByWorkspace={new Map()}
                  ensureCanvas={async () => undefined}
                  ensureWorkspaceCanvas={async () => undefined}
                  shellStatus="loading"
                  onRetry={() => undefined}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] opacity-60">
            reduced-motion：本 gallery 的位移/呼吸类变体在 <code>prefers-reduced-motion: reduce</code>{' '}
            下取消动画，只保留轮廓与颜色（证据见 R1 浏览器脚本的 emulation 断言）。
          </p>
          <p className="flex items-center gap-2 text-[11px] opacity-60">
            <Home className="h-3 w-3" aria-hidden />
            族根节点统一带 <code>data-lcos-family</code> + <code>data-lcos-variant</code>，供 e2e 断言。
          </p>
        </Section>
      </div>
    </div>
  );
}
