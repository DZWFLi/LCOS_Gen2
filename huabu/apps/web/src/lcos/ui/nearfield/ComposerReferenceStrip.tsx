import { LcosNearfieldGlyph } from './LcosNearfieldGlyph';
import { LcosIconButton } from '../primitives/LcosIconButton';

import type { ComposerReferenceViewItem } from './composerViewTypes';
import type { JSX } from 'react';

/** Gen1 ordered explicit-reference strip, reskinned with Figma Oreo Tag geometry. */
export function ComposerReferenceStrip({
  items,
}: {
  readonly items: readonly ComposerReferenceViewItem[];
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="lcos-composer-references" role="list" aria-label="本次显式引用">
      {items.map((item, index) => (
        <div
          key={item.key}
          role="listitem"
          className="lcos-composer-reference"
          data-lcos-composer-ref
          data-reference-key={item.key}
          data-reference-order={index + 1}
          data-unavailable={item.unavailableReason !== undefined || undefined}
          title={item.unavailableReason ?? item.label}
        >
          {item.onOpen ? <button type="button" className="lcos-composer-reference-open" onClick={item.onOpen}
            aria-label={`查看引用 ${item.label}${item.versionLabel ? ` · ${item.versionLabel}` : ''}`}>
            <span className="lcos-composer-reference-icon">{item.thumbnailSrc
              ? <img src={item.thumbnailSrc} alt="" loading="lazy" /> : item.icon ?? <LcosNearfieldGlyph name="attach" size={14} />}</span>
            <span className="lcos-composer-reference-label">{item.label}</span>
            {item.versionLabel && <small>{item.versionLabel}</small>}
          </button> : <><span className="lcos-composer-reference-icon">{item.thumbnailSrc
            ? <img src={item.thumbnailSrc} alt="" loading="lazy" /> : item.icon ?? <LcosNearfieldGlyph name="attach" size={14} />}</span>
            <span className="lcos-composer-reference-label">{item.label}</span>
            {item.versionLabel && <small>{item.versionLabel}</small>}</>}
          {item.onRemove !== undefined && (
            <LcosIconButton
              type="button"
              className="lcos-composer-reference-remove"
              aria-label={`移除引用 ${item.label}`}
              onClick={item.onRemove}
            >
              <LcosNearfieldGlyph name="close" size={10} />
            </LcosIconButton>
          )}
        </div>
      ))}
    </div>
  );
}
