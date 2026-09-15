// LcosSpeciesBodies — 节点物种 body 注册表（Figma Main/NodeSpecies 语义；宪法 P11 内容优先）。
// 形态语言：结构化区分（图标/边框/角标/比例/状态位），不只靠颜色。
// 所有 body 只接收中性 slot input（nodeId/nodeType/data），不直连 Core/Huabu store（只读 data）。
// unknown 不静默降级——显示诊断原因。

import {
  NODE_SPECIES_LABEL,
  resolveVisualFamily,
  type LcosNodeSpecies,
  type LcosVisualFamily,
} from '@local-creative-os/web-gen2';
import {
  Bookmark,
  CircleDot,
  Folder,
  Grip,
  Puzzle,
  Router,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { resolveArtifactUrl } from '@/api/artifact';
import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';
import useCanvasStore from '@/store/canvasStore';

import { SourceMorphology } from './source/SourceMorphology';
import { useLcosDensity } from './useLcosDensity';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CanvasNodeBodySlotInput } from '@/lcos-seam/types';
import type { ComponentType, JSX } from 'react';

/** 物种 → 主识别色（边缘/角标；浓度统一收敛，不作为唯一区分）。 */
export const SPECIES_ACCENT: Readonly<Record<LcosNodeSpecies, string>> = {
  source: lcosTokens.color.muted,
  working: lcosTokens.color.info,
  draft: lcosTokens.color.pinAmber,
  'context-reference': lcosTokens.color.pinTeal,
  run: lcosTokens.color.pinViolet,
  decision: lcosTokens.color.accent,
  glyth: lcosTokens.color.inverse,
  collection: lcosTokens.color.info,
  'workflow-collection': lcosTokens.color.pinTeal,
  portal: lcosTokens.color.pinViolet,
  'prompt-frame': lcosTokens.color.pinAmber,
  unknown: lcosTokens.color.danger,
};

function titleOf(data: Readonly<Record<string, unknown>> | undefined): string {
  const raw = data?.label ?? data?.title;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '未命名';
}

function SpeciesChip({ label, accent }: { label: string; accent: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
      style={{
        color: accent,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
        minHeight: 18,
      }}
    >
      {label}
    </span>
  );
}

function TitleLine({ text, density }: { text: string; density?: 'mark' | 'summary' | 'working' | 'reading' }): JSX.Element {
  // 近景（reading）用更大的标题：Main 首屏的"可辨身份"主要靠标题，而不是靠放大到 200%。
  const large = density === 'reading';
  return (
    <span
      className={`line-clamp-2 font-semibold leading-snug ${large ? 'text-lg' : 'text-sm'}`}
      style={{ color: lcosTokens.color.text }}
    >
      {text}
    </span>
  );
}

function MetaLine({ text }: { text: string }): JSX.Element {
  // 次级行永远贴在卡片底部：卡片随之有真实的信息层级（标题在上、事实在下），
  // 而不是一坨居中文字漂在空白里（首轮视觉否决的"构图极空"）。
  return (
    <span className="mt-auto block text-[11px]" style={{ color: lcosTokens.color.muted }}>
      {text}
    </span>
  );
}

/** 各物种 body 内容（frame 由 LcosSpeciesBody / GlythNodeBody 提供）。 */
export function LcosSpeciesBodyContent({
  species,
  title,
  density,
  secondary,
  preview,
  visualFamily = 'unknown',
  mediaSrc,
  durationSec,
  worldWidth,
}: {
  species: LcosNodeSpecies;
  title: string;
  density: 'mark' | 'summary' | 'working' | 'reading';
  visualFamily?: LcosVisualFamily;
  mediaSrc?: string;
  durationSec?: number;
  worldWidth?: number;
  /**
   * 真实次级行（来自 Core 元数据：kind/受管/可用性/revision）。
   * 有真实事实就显示真实事实；没有就退回该物种的**形态说明**（说清这是什么，不假装有数据）。
   */
  secondary?: string;
  /**
   * 真实正文预览（来自 Core FileRecord 内容，用户裁决 B 的 `preview` 位）。
   * 读不到就不显示（不编造正文）——首屏内容密度靠真实正文，不靠放大节点。
   */
  preview?: string;
}): JSX.Element {
  // `flex: 1` 让内容列撑满 body 高度，次级行才能真正贴底（见上面 source 分支的注释）。
  const root = { display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' as const, gap: 6, width: '100%', minWidth: 0 };
  const meta = (fallback: string): JSX.Element => <MetaLine text={secondary ?? fallback} />;
  switch (species) {
    case 'source':
      return (
        <div style={root} data-lcos-species="source" data-lcos-visual-family={visualFamily}>
          <SourceMorphology
            family={visualFamily}
            title={title}
            secondary={secondary}
            preview={preview}
            mediaSrc={mediaSrc}
            durationSec={durationSec}
            density={density}
            worldWidth={worldWidth}
          />
        </div>
      );

    case 'working':
      return (
        <div style={root} data-lcos-species="working">
          {density !== 'mark' && <SpeciesChip label="加工中" accent={SPECIES_ACCENT.working} />}
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-3 w-1 shrink-0 rounded-full" style={{ background: SPECIES_ACCENT.working }} />
            <div className="min-w-0 flex-1">
              <TitleLine text={title} density={density} />
              {density !== 'mark' && meta('当前加工 · 活跃')}
            </div>
          </div>
        </div>
      );

    case 'draft':
      return (
        <div style={root} data-lcos-species="draft">
          <div className="flex items-center gap-1.5">
            <SpeciesChip label="Draft" accent={SPECIES_ACCENT.draft} />
            <Sparkles className="h-3 w-3" style={{ color: SPECIES_ACCENT.draft }} aria-hidden />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('AI 产出 · 待 Review，尚未成为 Current')}
        </div>
      );

    case 'context-reference':
      return (
        <div style={root} data-lcos-species="context-reference">
          <div className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT['context-reference'] }} aria-hidden />
            <SpeciesChip label="引用" accent={SPECIES_ACCENT['context-reference']} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('来源锚点 · 可定位')}
        </div>
      );

    case 'run':
      return (
        <div style={root} data-lcos-species="run">
          {density !== 'mark' && (
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full lcos-static-pulse" style={{ background: SPECIES_ACCENT.run }} />
              <SpeciesChip label="运行" accent={SPECIES_ACCENT.run} />
            </div>
          )}
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('执行状态 · 以真实回执为准')}
        </div>
      );

    case 'decision':
      return (
        <div style={root} data-lcos-species="decision">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT.decision }} aria-hidden />
            <SpeciesChip label="决策" accent={SPECIES_ACCENT.decision} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('版本标记 · 可恢复')}
        </div>
      );

    case 'glyth':
      return (
        <div style={root} data-lcos-species="glyth">
          <div className="flex h-full items-stretch gap-2">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
            >
              {(title.charAt(0) || '?').toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <TitleLine text={title} density={density} />
              {density !== 'mark' && meta('会话 · 双击打开会话窗口')}
            </div>
          </div>
        </div>
      );

    case 'collection':
      return (
        <div style={root} data-lcos-species="collection">
          <div className="flex items-center gap-1.5">
            <Folder className="h-4 w-4" style={{ color: SPECIES_ACCENT.collection }} aria-hidden />
            <SpeciesChip label="集合" accent={SPECIES_ACCENT.collection} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('按事情/时间组织 · 可展开')}
        </div>
      );

    case 'workflow-collection':
      return (
        <div style={root} data-lcos-species="workflow-collection">
          <div className="flex items-center gap-1.5">
            <Grip className="h-4 w-4" style={{ color: SPECIES_ACCENT['workflow-collection'] }} aria-hidden />
            <SpeciesChip label="工作流" accent={SPECIES_ACCENT['workflow-collection']} />
          </div>
          <TitleLine text={title} density={density} />
        </div>
      );

    case 'portal':
      return (
        <div style={root} data-lcos-species="portal">
          <div className="flex items-center gap-1.5">
            <Router className="h-4 w-4" style={{ color: SPECIES_ACCENT.portal }} aria-hidden />
            <SpeciesChip label="入口" accent={SPECIES_ACCENT.portal} />
          </div>
          <TitleLine text={title} density={density} />
          {density !== 'mark' && meta('投影锚点 · 进入现场')}
        </div>
      );

    case 'prompt-frame':
      return (
        <div style={root} data-lcos-species="prompt-frame">
          <div className="flex items-center gap-1.5">
            <Puzzle className="h-4 w-4" style={{ color: SPECIES_ACCENT['prompt-frame'] }} aria-hidden />
            <SpeciesChip label="提示" accent={SPECIES_ACCENT['prompt-frame']} />
          </div>
          <TitleLine text={title} density={density} />
        </div>
      );

    case 'unknown':
    default:
      return (
        <div style={root} data-lcos-species="unknown">
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-4 w-4" style={{ color: SPECIES_ACCENT.unknown }} aria-hidden />
            <SpeciesChip label="未分类" accent={SPECIES_ACCENT.unknown} />
          </div>
          <TitleLine text={title} density={density} />
          <MetaLine text="缺少可辨识的 Core 元数据 · 需要诊断" />
        </div>
      );
  }
}

/** 物种 body：密度走 `useLcosDensity`（唯一来源，屏幕像素 + 节点数封顶）。 */
function LcosSpeciesBody({
  species,
  input,
}: {
  species: LcosNodeSpecies;
  input: CanvasNodeBodySlotInput;
}): JSX.Element {
  const density = useLcosDensity();
  const presentation = useLcosNodePresentation();
  const canvasId = useCanvasStore((state) => state.canvasId);
  const title = titleOf(input.data as Readonly<Record<string, unknown>> | undefined);
  // Core facts are read from the single reference store. The visual family is
  // resolved from those facts, never from a title or node id guess.
  const ref = useLcosReferenceStore((s) => s.nodeEntityRefs.get(input.nodeId));
  const descriptor = ref?.descriptor;
  const visualFamily = species === 'source'
    ? resolveVisualFamily({
        entityType: ref?.entityType,
        artifactKind: descriptor?.artifactKind,
        mimeType: descriptor?.mimeType,
        sourceKind: descriptor?.sourceKind,
        managed: descriptor?.managed,
      })
    : 'unknown';
  const presentationMediaSrc = input.data.presentationMediaSrc;
  const rawMediaSrc = input.data.src;
  const mediaSrc =
    typeof presentationMediaSrc === 'string' && presentationMediaSrc !== ''
      ? presentationMediaSrc
      : typeof rawMediaSrc === 'string' && rawMediaSrc !== ''
        ? resolveArtifactUrl(rawMediaSrc, canvasId ?? undefined)
        : undefined;
  const rawDuration = input.data.presentationDurationSec;
  const durationSec = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : undefined;
  const isFreeformSource = species === 'source';
  return (
    <div
      data-lcos-species-body
      data-lcos-density={density}
      data-lcos-visual-family={visualFamily}
      className={`flex h-full w-full flex-col ${isFreeformSource ? 'overflow-visible' : 'overflow-hidden'}`}
      onDoubleClick={
        species === 'source' && ref?.entityType === 'artifact'
          ? (event) => {
              event.stopPropagation();
              useLcosShellStore.getState().openWindow('reader', `阅读 · ${title}`, ref.entityId);
            }
          : undefined
      }
      style={isFreeformSource
        ? { background: 'transparent', border: 0, borderRadius: 0, boxShadow: 'none', padding: 0 }
        : {
            background: lcosTokens.color.surface,
            border: `1px solid color-mix(in srgb, ${SPECIES_ACCENT[species]} 18%, transparent)`,
            borderRadius: lcosTokens.radius.cardSmall,
            boxShadow: lcosTokens.shadow.default,
            padding: 10,
          }}
    >
      <LcosSpeciesBodyContent
        species={species}
        title={title}
        density={density}
        secondary={descriptor?.secondaryLine}
        preview={descriptor?.preview}
        visualFamily={visualFamily}
        mediaSrc={mediaSrc}
        durationSec={durationSec}
        worldWidth={presentation?.worldWidth}
      />
    </div>
  );
}

/**
 * 物种 → body 组件工厂。全应用只有 `lcosNodeCardRegistry` 使用它；
 * 这里不再对外导出一张并行的物种表（R2：单一 junction + 单一注册表）。
 */
export function speciesBodyFor(species: LcosNodeSpecies): ComponentType<CanvasNodeBodySlotInput> {
  return (input) => <LcosSpeciesBody species={species} input={input} />;
}

void NODE_SPECIES_LABEL; // 标签表供未来无障碍/工具提示使用
