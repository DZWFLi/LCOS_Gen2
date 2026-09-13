// Assembly 内容卡视图（T5 背景阅读交付 3/3 切片）：WarehouseItemV1 → 卡物种视图。
// 纯函数，React-free。物种 = workflow / collection / artifact / scene / note /
// conversation / resource；封面/预览缺失用物种图标+色块兜底，不伪造图像。
// 「用于当前会话」只改本地 draft 引用（presentation），不触碰 Core truth。

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export type AssemblyCardSpeciesV1 =
  | 'workflow'
  | 'collection'
  | 'artifact'
  | 'scene'
  | 'note'
  | 'conversation'
  | 'resource';

export interface AssemblyCardViewStateV1 {
  readonly key: string;
  readonly kind: WarehouseItemV1['kind'];
  readonly species: AssemblyCardSpeciesV1;
  readonly title: string;
  /** 一行来源/组织说明（provenance 或 kind 语义）。 */
  readonly subtitle?: string;
  readonly visualFamily?: WarehouseItemV1['visualFamily'];
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly usageCount: number;
  readonly neighborCount?: number;
  readonly updatedAt?: string;
  /** 是否已在当前 Composer 草稿引用中（"已加入草稿 · 未发送"）。 */
  readonly referenced: boolean;
  /** 写入 reference store 的稳定键（assembly:<refEntityType>:<id>）。 */
  readonly referenceKey: string;
  /** 提交时映射的 reference entityType（runInputFromDraft 可识别集）。 */
  readonly refEntityType: string;
  /** 该引用类型是否能随 Run 提交（note/resource 按 F6B 裁决跳过）。 */
  readonly submittable: boolean;
}

const SPECIES_BY_KIND: Readonly<Record<WarehouseItemV1['kind'], AssemblyCardSpeciesV1>> = {
  artifact: 'artifact',
  note: 'note',
  conversation: 'conversation',
  resource: 'resource',
  context: 'collection', // context scope 复用集合文件夹卡物种
  workflow: 'workflow',
  scene: 'scene',
  collection: 'collection',
};

/** 提交引用类型映射（与 ComposerController.runInputFromDraft 可识别集一致；
 *  scene.id 即 workspaceId、context/workflow/collection 是 scope）。 */
const REF_ENTITY_TYPE_BY_KIND: Readonly<Record<WarehouseItemV1['kind'], string>> = {
  artifact: 'artifact',
  note: 'note',
  conversation: 'conversation',
  resource: 'resource',
  context: 'scope',
  workflow: 'scope',
  scene: 'workspace',
  collection: 'scope',
};

const SUBMITTABLE_ENTITY_TYPES: ReadonlySet<string> = new Set(['artifact', 'conversation', 'scope', 'workspace', 'view', 'component']);

export function referenceKeyForAssemblyItem(item: WarehouseItemV1): string {
  const refEntityType = REF_ENTITY_TYPE_BY_KIND[item.kind] ?? 'resource';
  return `assembly:${refEntityType}:${item.entityRef.id}`;
}

function subtitleFor(item: WarehouseItemV1): string | undefined {
  switch (item.kind) {
    case 'workflow':
      return '工作流';
    case 'collection':
      return '按事情组织';
    case 'context':
      return '上下文集合';
    case 'scene':
      return '现场';
    case 'conversation':
      return '接收会话';
    case 'resource':
      return '外部来源';
    case 'note':
      return '笔记';
    case 'artifact':
      return item.provenance === undefined
        ? item.visualFamily ?? undefined
        : item.provenance.origin === 'run-return'
          ? '来自 Run 产出'
          : item.provenance.origin === 'import'
            ? '导入'
            : item.provenance.origin === 'capture'
              ? '剪藏'
              : item.visualFamily ?? undefined;
  }
}

export function assemblyCardViewV1(
  item: WarehouseItemV1,
  referencedKeys: ReadonlySet<string>,
): AssemblyCardViewStateV1 {
  const refEntityType = REF_ENTITY_TYPE_BY_KIND[item.kind] ?? 'resource';
  const referenceKey = `assembly:${refEntityType}:${item.entityRef.id}`;
  const subtitle = subtitleFor(item);
  const neighborCount = item.relationHint?.neighborCount;
  return {
    key: referenceKey,
    kind: item.kind,
    species: SPECIES_BY_KIND[item.kind] ?? 'resource',
    title: item.title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(item.visualFamily === undefined ? {} : { visualFamily: item.visualFamily }),
    ...(item.mimeType === undefined ? {} : { mimeType: item.mimeType }),
    ...(item.fileName === undefined ? {} : { fileName: item.fileName }),
    usageCount: item.usageCount,
    ...(neighborCount === undefined ? {} : { neighborCount }),
    ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
    referenced: referencedKeys.has(referenceKey),
    referenceKey,
    refEntityType,
    submittable: SUBMITTABLE_ENTITY_TYPES.has(refEntityType),
  };
}
