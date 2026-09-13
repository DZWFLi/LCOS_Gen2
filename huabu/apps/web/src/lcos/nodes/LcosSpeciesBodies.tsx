// LcosSpeciesBodies — 节点物种 body 注册表（Figma Main/NodeSpecies 语义；宪法 P11 内容优先）。
// 形态语言：结构化区分（图标/边框/角标/比例/状态位），不只靠颜色。
// 所有 body 只接收中性 slot input（nodeId/nodeType/data），不直连 Core/Huabu store（只读 data）。
// unknown 不静默降级——显示诊断原因。

import { NODE_SPECIES_LABEL, type LcosNodeSpecies } from '@local-creative-os/web-gen2';
import {
  Bookmark,
  CircleDot,
  FileText,
  Folder,
  Grip,
  Puzzle,
  Router,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';


import { useLcosDensity } from './useLcosDensity';
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
        background: `${accent}14`,
        border: `1px solid ${accent}33`,
        minHeight: 18,
      }}
    >
      {label}
    </span>
  );
}

function TitleLine({ text }: { text: string }): JSX.Element {
  return (
    <span className="line-clamp-2 text-sm font-semibold leading-snug" style={{ color: lcosTokens.color.text }}>
      {text}
    </span>
  );
}

function MetaLine({ text }: { text: string }): JSX.Element {
  return (
    <span className="text-[11px]" style={{ color: lcosTokens.color.muted }}>
      {text}
    </span>
  );
}

/** 各物种 body 内容（frame 由 LcosSpeciesBody / GlythNodeBody 提供）。 */
export function LcosSpeciesBodyContent({
  species,
  title,
  density,
}: {
  species: LcosNodeSpecies;
  title: string;
  density: 'mark' | 'summary' | 'working' | 'reading';
}): JSX.Element {
  const root = { display: 'flex', flexDirection: 'column' as const, gap: 6, width: '100%', minWidth: 0 };

  switch (species) {
    case 'source':
      return (
        <div style={root} data-lcos-species="source">
          {density !== 'mark' && <SpeciesChip label="材料" accent={SPECIES_ACCENT.source} />}
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" style={{ color: SPECIES_ACCENT.source }} aria-hidden />
            <div className="min-w-0 flex-1">
              <TitleLine text={title} />
              {density === 'reading' && <MetaLine text="来源文件 · 只读原始" />}
            </div>
          </div>
        </div>
      );

    case 'working':
      return (
        <div style={root} data-lcos-species="working">
          {density !== 'mark' && <SpeciesChip label="加工中" accent={SPECIES_ACCENT.working} />}
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-1 h-3 w-1 shrink-0 rounded-full" style={{ background: SPECIES_ACCENT.working }} />
            <div className="min-w-0 flex-1">
              <TitleLine text={title} />
              {density === 'reading' && <MetaLine text="当前加工 · 活跃" />}
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
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="AI 产出 · 待 Review，尚未成为 Current" />}
        </div>
      );

    case 'context-reference':
      return (
        <div style={root} data-lcos-species="context-reference">
          <div className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT['context-reference'] }} aria-hidden />
            <SpeciesChip label="引用" accent={SPECIES_ACCENT['context-reference']} />
          </div>
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="来源锚点 · 可定位" />}
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
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="执行状态 · 以真实回执为准" />}
        </div>
      );

    case 'decision':
      return (
        <div style={root} data-lcos-species="decision">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: SPECIES_ACCENT.decision }} aria-hidden />
            <SpeciesChip label="决策" accent={SPECIES_ACCENT.decision} />
          </div>
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="版本标记 · 可恢复" />}
        </div>
      );

    case 'glyth':
      return (
        <div style={root} data-lcos-species="glyth">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse }}
            >
              {(title.charAt(0) || '?').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <TitleLine text={title} />
              {density === 'reading' && <MetaLine text="会话 · 双击打开工作台" />}
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
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="按事情/时间组织 · 可展开" />}
        </div>
      );

    case 'workflow-collection':
      return (
        <div style={root} data-lcos-species="workflow-collection">
          <div className="flex items-center gap-1.5">
            <Grip className="h-4 w-4" style={{ color: SPECIES_ACCENT['workflow-collection'] }} aria-hidden />
            <SpeciesChip label="工作流" accent={SPECIES_ACCENT['workflow-collection']} />
          </div>
          <TitleLine text={title} />
        </div>
      );

    case 'portal':
      return (
        <div style={root} data-lcos-species="portal">
          <div className="flex items-center gap-1.5">
            <Router className="h-4 w-4" style={{ color: SPECIES_ACCENT.portal }} aria-hidden />
            <SpeciesChip label="入口" accent={SPECIES_ACCENT.portal} />
          </div>
          <TitleLine text={title} />
          {density === 'reading' && <MetaLine text="投影锚点 · 进入现场" />}
        </div>
      );

    case 'prompt-frame':
      return (
        <div style={root} data-lcos-species="prompt-frame">
          <div className="flex items-center gap-1.5">
            <Puzzle className="h-4 w-4" style={{ color: SPECIES_ACCENT['prompt-frame'] }} aria-hidden />
            <SpeciesChip label="提示" accent={SPECIES_ACCENT['prompt-frame']} />
          </div>
          <TitleLine text={title} />
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
          <TitleLine text={title} />
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
  const title = titleOf(input.data as Readonly<Record<string, unknown>> | undefined);
  return (
    <div
      data-lcos-species-body
      data-lcos-density={density}
      className="flex h-full w-full flex-col overflow-hidden"
      style={{
        background: lcosTokens.color.surface,
        border: `1px solid ${SPECIES_ACCENT[species]}2E`,
        borderRadius: lcosTokens.radius.cardSmall,
        boxShadow: lcosTokens.shadow.default,
        padding: 10,
      }}
    >
      <LcosSpeciesBodyContent species={species} title={title} density={density} />
    </div>
  );
}

/** 物种 → body 组件（单一注册表；未命中由 seam 返回 native fallback）。 */
export const NODE_SPECIES_BODY: Readonly<Record<LcosNodeSpecies, ComponentType<CanvasNodeBodySlotInput>>> = {
  source: (input) => <LcosSpeciesBody species="source" input={input} />,
  working: (input) => <LcosSpeciesBody species="working" input={input} />,
  draft: (input) => <LcosSpeciesBody species="draft" input={input} />,
  'context-reference': (input) => <LcosSpeciesBody species="context-reference" input={input} />,
  run: (input) => <LcosSpeciesBody species="run" input={input} />,
  decision: (input) => <LcosSpeciesBody species="decision" input={input} />,
  glyth: (input) => <LcosSpeciesBody species="glyth" input={input} />,
  collection: (input) => <LcosSpeciesBody species="collection" input={input} />,
  'workflow-collection': (input) => <LcosSpeciesBody species="workflow-collection" input={input} />,
  portal: (input) => <LcosSpeciesBody species="portal" input={input} />,
  'prompt-frame': (input) => <LcosSpeciesBody species="prompt-frame" input={input} />,
  unknown: (input) => <LcosSpeciesBody species="unknown" input={input} />,
};

void NODE_SPECIES_LABEL; // 标签表供未来无障碍/工具提示使用