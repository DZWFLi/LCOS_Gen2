// Merge external (host-app) node renderers over Huabu's built-in nodeTypes.
//
// Safety rule (Phase A01): a host renderer can never silently replace a
// Huabu built-in key (`text`, `note`, `image`, ...). Collisions throw in
// dev builds and are refused (warn + skip) in production builds.

import type { NodeTypes } from '@xyflow/react';

import type { CanvasHostExtension, ExternalNodeRenderer } from './types';

export interface MergeNodeTypesOptions {
  /**
   * Dev-mode behavior on key collision: throw instead of warn + refuse.
   * The Canvas passes `import.meta.env.DEV`; tests pass an explicit value.
   */
  readonly isDev?: boolean;
}

/**
 * Merge host renderers over the built-in nodeTypes map.
 *
 * - No external renderers → the built-in map is returned as-is.
 * - A key colliding with a built-in is refused: dev throws, prod warns and
 *   keeps the built-in renderer.
 * - Non-colliding keys (e.g. `lcos/artifact`) are merged in.
 */
export function mergeNodeTypes(
  builtIn: Readonly<Record<string, ExternalNodeRenderer>>,
  external: CanvasHostExtension['nodeTypes'],
  options: MergeNodeTypesOptions = {},
): NodeTypes {
  if (!external) return builtIn as NodeTypes;

  const merged: Record<string, ExternalNodeRenderer> = { ...builtIn };
  for (const [key, renderer] of Object.entries(external)) {
    if (key in builtIn) {
      if (options.isDev) {
        throw new Error(
          `[lcos-seam] external node type "${key}" collides with a Huabu built-in; ` +
            'built-ins cannot be overridden. Register under a host namespace, e.g. "lcos/<species>".',
        );
      }
      // Production: refuse the override, keep the built-in renderer.
      console.warn(
        `[lcos-seam] refusing to override built-in node type "${key}"`,
      );
      continue;
    }
    merged[key] = renderer;
  }
  return merged;
}
