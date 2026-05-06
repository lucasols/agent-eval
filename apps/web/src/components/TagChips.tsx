import { convertToSentenceCase } from '@ls-stack/utils/stringUtils';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline } from '#src/style/helpers';

const TagList = styled.div`
  ${inline({ align: 'center', gap: 6 })}
  min-width: 0;
  flex-wrap: wrap;
`;

const TagChip = styled.span`
  max-width: 160px;
  padding: 2px 7px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 10.5px;
  line-height: 1.4;
`;

type TagChipsProps = { tags: readonly string[] };

export function formatEvalTagLabel(tag: string): string {
  return convertToSentenceCase(tag).toLowerCase();
}

export function TagChips({ tags }: TagChipsProps) {
  if (tags.length === 0) return null;
  return (
    <TagList>
      {tags.map((tag) => (
        <TagChip
          key={tag}
          title={tag}
        >
          {formatEvalTagLabel(tag)}
        </TagChip>
      ))}
    </TagList>
  );
}
