import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';

export type PathBreadcrumbSegment = {
  label: string;
  path: string;
};

type PathBreadcrumbProps = {
  segments: PathBreadcrumbSegment[];
  currentLabel: string;
  onSelect: (path: string) => void;
};

const Breadcrumb = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  ${monoFont};
  font-size: 13px;
  color: ${colors.textMuted.var};
`;

const BreadcrumbSep = styled.span`
  color: ${colors.textDim.var};
  margin: 0 6px;
`;

const BreadcrumbLink = styled.button`
  ${transition({ property: 'color' })}
  ${monoFont};
  appearance: none;
  background: transparent;
  border: none;
  padding: 0;
  color: ${colors.textMuted.var};
  cursor: pointer;

  &:hover {
    color: ${colors.text.var};
  }
`;

const BreadcrumbCurrent = styled.span`
  color: ${colors.text.var};
`;

export function PathBreadcrumb({
  segments,
  currentLabel,
  onSelect,
}: PathBreadcrumbProps) {
  return (
    <Breadcrumb>
      {segments.map(({ label, path }) => (
        <span key={path}>
          <BreadcrumbLink
            type="button"
            onClick={() => onSelect(path)}
          >
            {label}
          </BreadcrumbLink>
          <BreadcrumbSep>/</BreadcrumbSep>
        </span>
      ))}
      <BreadcrumbCurrent>{currentLabel}</BreadcrumbCurrent>
    </Breadcrumb>
  );
}
