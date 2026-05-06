import { type CacheMode } from '@agent-evals/shared';
import { useState } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { Modal } from '#src/components/Modal';
import { formatEvalTagLabel } from '#src/components/TagChips';
import { colors } from '#src/style/colors';
import { ellipsis, inline, monoFont, stack } from '#src/style/helpers';

type CaseOption = { id: string; tags: string[] };

type CasePickerModalProps = {
  isOpen: boolean;
  title: string;
  subtitle: string;
  cases: CaseOption[];
  selectedCaseIds: string[];
  cacheMode: CacheMode;
  temporary: boolean;
  onCacheModeChange: (cacheMode: CacheMode) => void;
  onTemporaryChange: (temporary: boolean) => void;
  onSelectedCaseIdsChange: (caseIds: string[]) => void;
  onToggleCaseId: (caseId: string) => void;
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

const CaseList = styled.div`
  ${stack({ gap: 0 })}
  max-height: 340px;
  overflow: auto;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
`;

const CaseRow = styled.label`
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

const CaseId = styled.span`
  ${monoFont};
  ${ellipsis};
  min-width: 0;
  font-size: 12px;
  color: ${colors.text.var};
`;

const CaseMain = styled.span`
  ${stack({ gap: 4 })}
  min-width: 0;
  flex: 1;
`;

const TagList = styled.span`
  ${inline({ align: 'center', gap: 4 })}
  min-width: 0;
  flex-wrap: wrap;
`;

const TagChip = styled.span`
  max-width: 140px;
  padding: 1px 6px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 10px;
  line-height: 1.4;
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

const TagFilterSelect = styled(CacheModeSelect)`
  max-width: 180px;
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

export function CasePickerModal({
  isOpen,
  title,
  subtitle,
  cases,
  selectedCaseIds,
  cacheMode,
  temporary,
  onCacheModeChange,
  onTemporaryChange,
  onSelectedCaseIdsChange,
  onToggleCaseId,
  onCancel,
  onRun,
}: CasePickerModalProps) {
  const availableTags = [
    ...new Set(cases.flatMap((caseOption) => caseOption.tags)),
  ];
  const [selectedTag, setSelectedTag] = useState('');
  const visibleCases =
    selectedTag.length === 0
      ? cases
      : cases.filter((caseOption) => caseOption.tags.includes(selectedTag));
  const visibleCaseIds = visibleCases.map((caseOption) => caseOption.id);

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
              disabled={selectedCaseIds.length === 0}
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
            {selectedCaseIds.length} of {cases.length} selected
          </Meta>
          <ToolbarActions>
            {availableTags.length > 0 ? (
              <TagFilterSelect
                aria-label="Filter by tag"
                value={selectedTag}
                onChange={(event) => setSelectedTag(event.currentTarget.value)}
              >
                <option value="">All tags</option>
                {availableTags.map((tag) => (
                  <option
                    key={tag}
                    value={tag}
                  >
                    {formatEvalTagLabel(tag)}
                  </option>
                ))}
              </TagFilterSelect>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => onSelectedCaseIdsChange(visibleCaseIds)}
              disabled={
                visibleCaseIds.length === 0 ||
                visibleCaseIds.every((caseId) =>
                  selectedCaseIds.includes(caseId),
                )
              }
            >
              Select visible
            </Button>
            <Button
              variant="ghost"
              onClick={() => onSelectedCaseIdsChange([])}
              disabled={selectedCaseIds.length === 0}
            >
              Clear
            </Button>
          </ToolbarActions>
        </Toolbar>

        {cases.length > 0 ? (
          <CaseList>
            {visibleCases.map((caseOption) => (
              <CaseRow key={caseOption.id}>
                <input
                  type="checkbox"
                  checked={selectedCaseIds.includes(caseOption.id)}
                  onChange={() => onToggleCaseId(caseOption.id)}
                />
                <CaseMain>
                  <CaseId title={caseOption.id}>{caseOption.id}</CaseId>
                  {caseOption.tags.length > 0 ? (
                    <TagList>
                      {caseOption.tags.map((tag) => (
                        <TagChip
                          key={tag}
                          title={tag}
                        >
                          {formatEvalTagLabel(tag)}
                        </TagChip>
                      ))}
                    </TagList>
                  ) : null}
                </CaseMain>
              </CaseRow>
            ))}
          </CaseList>
        ) : (
          <Empty>
            Case ids are not available yet. Run this eval once to let the app
            discover its authored cases.
          </Empty>
        )}
      </Body>
    </Modal>
  );
}
