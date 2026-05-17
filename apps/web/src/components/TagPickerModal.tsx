import { type CacheMode } from '@agent-evals/shared';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { Modal } from '#src/components/Modal';
import { formatEvalTagLabel } from '#src/components/TagChips';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';

type TagPickerModalProps = {
  isOpen: boolean;
  title: string;
  subtitle: string;
  tags: string[];
  selectedTags: string[];
  cacheMode: CacheMode;
  temporary: boolean;
  onCacheModeChange: (cacheMode: CacheMode) => void;
  onTemporaryChange: (temporary: boolean) => void;
  onSelectedTagsChange: (tags: string[]) => void;
  onToggleTag: (tag: string) => void;
  onCancel: () => void;
  onRun: () => void;
};

const Body = styled.div`
  ${stack({ gap: 14 })}
  min-width: min(520px, calc(100vw - 72px));
`;

const Toolbar = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
`;

const ToolbarActions = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const Meta = styled.div`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const TagList = styled.div`
  ${stack({ gap: 0 })}
  max-height: 340px;
  overflow: auto;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
`;

const TagRow = styled.label`
  ${inline({ align: 'center', gap: 10 })}
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid ${colors.border.var};
  cursor: pointer;

  &:last-child {
    border-bottom: 0;
  }

  &:hover {
    background: ${colors.surface.var};
  }

  & > input {
    flex-shrink: 0;
  }
`;

const TagName = styled.span`
  min-width: 0;
  font-size: 12px;
  color: ${colors.text.var};
`;

const Empty = styled.div`
  padding: 14px;
  color: ${colors.textMuted.var};
  font-size: 12.5px;
  line-height: 1.45;
`;

const FooterLeft = styled.div`
  ${inline({ align: 'center', gap: 12 })}
`;

const FooterRight = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const CacheModeSelect = styled.select`
  height: 32px;
  padding: 0 10px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  font-size: 12.5px;
`;

const TemporaryToggle = styled.label`
  ${inline({ align: 'center', gap: 6 })}
  color: ${colors.textMuted.var};
  font-size: 12px;
  cursor: pointer;

  & > input {
    flex-shrink: 0;
  }
`;

function readCacheMode(value: string): CacheMode {
  if (value === 'bypass' || value === 'refresh') return value;
  return 'use';
}

export function TagPickerModal({
  isOpen,
  title,
  subtitle,
  tags,
  selectedTags,
  cacheMode,
  temporary,
  onCacheModeChange,
  onTemporaryChange,
  onSelectedTagsChange,
  onToggleTag,
  onCancel,
  onRun,
}: TagPickerModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      footer={
        <>
          <FooterLeft>
            <CacheModeSelect
              aria-label="Cache mode"
              value={cacheMode}
              onChange={(event) =>
                onCacheModeChange(readCacheMode(event.currentTarget.value))
              }
            >
              <option value="use">Use cache</option>
              <option value="bypass">No cache</option>
              <option value="refresh">Refresh cache</option>
            </CacheModeSelect>
            <TemporaryToggle>
              <input
                type="checkbox"
                checked={temporary}
                onChange={(event) =>
                  onTemporaryChange(event.currentTarget.checked)
                }
              />
              Temporary
            </TemporaryToggle>
          </FooterLeft>
          <FooterRight>
            <Button
              variant="ghost"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onRun}
              disabled={selectedTags.length === 0}
            >
              Run selected
            </Button>
          </FooterRight>
        </>
      }
    >
      <Body>
        <Toolbar>
          <Meta>
            {selectedTags.length} of {tags.length} selected
          </Meta>
          <ToolbarActions>
            <Button
              variant="ghost"
              onClick={() => onSelectedTagsChange(tags)}
              disabled={tags.length === selectedTags.length}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              onClick={() => onSelectedTagsChange([])}
              disabled={selectedTags.length === 0}
            >
              Clear
            </Button>
          </ToolbarActions>
        </Toolbar>

        {tags.length > 0 ? (
          <TagList>
            {tags.map((tag) => (
              <TagRow key={tag}>
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag)}
                  onChange={() => onToggleTag(tag)}
                />
                <Tooltip content={tag}>
                  <TagName>{formatEvalTagLabel(tag)}</TagName>
                </Tooltip>
              </TagRow>
            ))}
          </TagList>
        ) : (
          <Empty>No tags are available in this folder.</Empty>
        )}
      </Body>
    </Modal>
  );
}
