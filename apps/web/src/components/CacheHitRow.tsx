import {
  cacheEntrySchema,
  type CacheEntry,
  type CacheHitEntry,
} from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration, formatTimestamp } from '#src/utils/formatters';

const Card = styled.div`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const HeaderButton = styled.button`
  ${inline({ gap: 10, align: 'center' })}
  width: 100%;
  background: transparent;
  border: none;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  color: ${colors.text.var};

  &:hover {
    background: ${colors.surface.var};
  }
`;

const Caret = styled.span`
  ${inline({ align: 'center' })}
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const TypeChip = styled.span`
  ${kicker};
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.success.alpha(0.15)};
  color: ${colors.success.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  line-height: 1.2;
  flex-shrink: 0;
`;

const HeaderName = styled.span`
  ${monoFont};
  font-size: 12.5px;
  color: ${colors.text.var};
  word-break: break-word;
  flex: 1 1 auto;
  min-width: 0;
`;

const OriginTag = styled.span`
  ${monoFont};
  font-size: 10px;
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const HeaderMeta = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  ${monoFont};
  margin-left: auto;
  font-size: 11px;
  color: ${colors.textMuted.var};
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const Body = styled.div`
  ${stack({ gap: 12 })}
  padding: 12px 14px;
  border-top: 1px solid ${colors.border.var};
`;

const MetaRow = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  flex-wrap: wrap;
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const MetaItem = styled.span`
  ${inline({ gap: 4, align: 'center' })}
`;

const MetaLabel = styled.span`
  ${kicker};
  font-size: 9.5px;
  color: ${colors.textDim.var};
`;

const MetaValue = styled.span`
  ${monoFont};
  font-size: 11px;
  color: ${colors.text.var};
  word-break: break-all;
`;

const SectionWrapper = styled.div``;

const SectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  margin-bottom: 8px;
`;

const StatusMessage = styled.div`
  ${monoFont};
  font-size: 11.5px;
  color: ${colors.textMuted.var};
`;

const ErrorMessage = styled.div`
  ${monoFont};
  font-size: 11.5px;
  color: ${colors.error.var};
`;

function truncateKey(key: string): string {
  if (key.length <= 14) return key;
  return `${key.slice(0, 12)}…`;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; entry: CacheEntry }
  | { status: 'error'; message: string };

/**
 * Render one cache-hit card inside the case-drawer Cache hits tab.
 *
 * Collapsed by default. The header shows the source (SPAN/VALUE), operation
 * name, an optional `(case root)` tag for spanless value caches, age, and a
 * truncated key. Click toggles expansion and triggers a one-time fetch of the
 * persisted cache entry from `/api/cache/:namespace/:key` so the cached
 * `returnValue` and `finalAttributes` (when present) can be inspected via a
 * `JsonViewer`.
 */
export function CacheHitRow({ entry }: { entry: CacheHitEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });

  async function loadEntry() {
    if (fetchState.status === 'loading' || fetchState.status === 'loaded') {
      return;
    }
    setFetchState({ status: 'loading' });
    const url = `/api/cache/${encodeURIComponent(entry.namespace)}/${encodeURIComponent(entry.key)}`;
    const fetchResult = await resultify(() => fetch(url));
    if (fetchResult.error) {
      setFetchState({ status: 'error', message: fetchResult.error.message });
      return;
    }
    const response = fetchResult.value;
    if (!response.ok) {
      setFetchState({
        status: 'error',
        message: `cache entry not available (${String(response.status)})`,
      });
      return;
    }
    const jsonResult = await resultify(() => response.json());
    if (jsonResult.error) {
      setFetchState({ status: 'error', message: jsonResult.error.message });
      return;
    }
    const parseResult = resultify(() =>
      cacheEntrySchema.parse(jsonResult.value),
    );
    if (parseResult.error) {
      setFetchState({ status: 'error', message: parseResult.error.message });
      return;
    }
    setFetchState({ status: 'loaded', entry: parseResult.value });
  }

  function handleToggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    void loadEntry();
  }

  const ageLabel = entry.age !== undefined ? formatDuration(entry.age) : null;
  const finalAttributes =
    fetchState.status === 'loaded'
      ? fetchState.entry.recording.finalAttributes
      : null;
  const hasFinalAttributes =
    finalAttributes !== null && Object.keys(finalAttributes).length > 0;

  return (
    <Card>
      <HeaderButton
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <Caret>{expanded ? <ChevronDown /> : <ChevronRight />}</Caret>
        <TypeChip>{entry.source === 'span' ? 'SPAN' : 'VALUE'}</TypeChip>
        <HeaderName>{entry.name}</HeaderName>
        {entry.origin === 'caseRoot' ? (
          <OriginTag>(case root)</OriginTag>
        ) : null}
        <HeaderMeta>
          {ageLabel !== null ? <span>{ageLabel} old</span> : null}
          <span>{truncateKey(entry.key)}</span>
        </HeaderMeta>
      </HeaderButton>

      {expanded ? (
        <Body>
          <MetaRow>
            <MetaItem>
              <MetaLabel>NS</MetaLabel>
              <MetaValue>{entry.namespace}</MetaValue>
            </MetaItem>
            {entry.storedAt !== undefined ? (
              <MetaItem>
                <MetaLabel>STORED</MetaLabel>
                <MetaValue>{formatTimestamp(entry.storedAt)}</MetaValue>
              </MetaItem>
            ) : null}
            <MetaItem>
              <MetaLabel>KEY</MetaLabel>
              <MetaValue>{entry.key}</MetaValue>
            </MetaItem>
          </MetaRow>

          {fetchState.status === 'loading' ? (
            <StatusMessage>Loading cached value…</StatusMessage>
          ) : null}

          {fetchState.status === 'error' ? (
            <ErrorMessage>
              Could not load cached value: {fetchState.message}
            </ErrorMessage>
          ) : null}

          {fetchState.status === 'loaded' ? (
            <>
              <SectionWrapper>
                <SectionLabel>Cached return value</SectionLabel>
                <JsonViewer
                  value={fetchState.entry.recording.returnValue}
                  compact
                  maxHeight="raw"
                  collapsed={6}
                />
              </SectionWrapper>
              {hasFinalAttributes ? (
                <SectionWrapper>
                  <SectionLabel>Replayed span attributes</SectionLabel>
                  <JsonViewer
                    value={finalAttributes}
                    compact
                    maxHeight="raw"
                    collapsed={6}
                  />
                </SectionWrapper>
              ) : null}
            </>
          ) : null}
        </Body>
      ) : null}
    </Card>
  );
}
