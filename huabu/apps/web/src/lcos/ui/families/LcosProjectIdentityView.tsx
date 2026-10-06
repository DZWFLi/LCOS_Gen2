// Figma 5386:212。链接及导航回调仍由 Shell 持有，View 不读 route/store。
import { FigmaShellGlyph } from '../FigmaShellGlyph';

export function LcosProjectIdentityView({ name, worksiteName }: { readonly name: string; readonly worksiteName?: string }): React.JSX.Element {
  const resolvedWorksiteName = worksiteName?.trim();
  return <span data-lcos-project-identity-content>
    <FigmaShellGlyph name="project" size={18} />
    <span data-lcos-project-identity-label>
      {name}
      {resolvedWorksiteName && <><span aria-hidden="true"> / </span>{resolvedWorksiteName}</>}
    </span>
  </span>;
}
