import { type CacheActivityEntry } from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { ChevronDown, ChevronRight, GitCompare, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { CacheRawKeyCompareModal } from '#src/components/CacheRawKeyCompareModal';
import { JsonViewer } from '#src/components/JsonViewer';
import { LoadingLine } from '#src/components/LoadingState';
import { cacheEntryStore, deleteCacheEntry } from '#src/stores/cacheStore';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import type { ScopedCacheActivityPhase } from '#src/utils/cacheActivity';
import { formatTimestamp } from '#src/utils/formatters';

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
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  line-height: 1.2;
  flex-shrink: 0;
`;

const StatusChip = styled.span<{ hit: boolean; added: boolean }>`
  ${kicker};
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  line-height: 1.2;
  flex-shrink: 0;

  &.hit {
    background: ${colors.success.alpha(0.15)};
    color: ${colors.success.var};
  }

  &.added {
    background: ${colors.accent.alpha(0.12)};
    color: ${colors.accentDim.var};
  }
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

const BodyActions = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  justify-content: flex-end;
`;

function truncateKey(key: string): string {
  if (key.length <= 14) return key;
  return `${key.slice(0, 12)}…`;
}

function getNonNegativeCacheAge(entry: CacheActivityEntry): number | null {
  if (entry.storedAt !== undefined) {
    const storedAtMs = Date.parse(entry.storedAt);
    if (Number.isFinite(storedAtMs)) {
      return Math.max(0, Date.now() - storedAtMs);
    }
  }

  if (entry.age === undefined || entry.age < 0) return null;
  return entry.age;
}

function formatCacheAge(entry: CacheActivityEntry): string | null {
  const ageMs = getNonNegativeCacheAge(entry);
  if (ageMs === null) return null;
  if (ageMs < 60_000) return 'just now';

  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 60) return `${String(totalMinutes)}m old`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes === 0
      ? `${String(totalHours)}h old`
      : `${String(totalHours)}h ${String(minutes)}m old`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0
    ? `${String(days)}d old`
    : `${String(days)}d ${String(hours)}h old`;
}

/**
 * Render one cache activity card inside the case-drawer Cache tab.
 *
 * Collapsed by default. The header shows whether the row reused an entry or
 * wrote a new one, the source (SPAN/VALUE), operation name, an optional
 * `(case root)` tag for spanless value caches, age when available, and a
 * truncated key. Click toggles expansion and triggers a one-time fetch of the
 * persisted cache entry from `/api/cache/:namespace/:key` so the cached
 * `returnValue` and `finalAttributes` (when present) can be inspected via a
 * `JsonViewer`.
 */
type CacheHitRowProps = {
  entry: CacheActivityEntry;
  phase: ScopedCacheActivityPhase;
  currentRunId: string;
  currentCaseKey: string;
  currentEvalKey: string;
  currentCacheIndex: number;
  forceDeleted?: boolean;
};

export function CacheHitRow({
  entry,
  phase,
  currentRunId,
  currentCaseKey,
  currentEvalKey,
  currentCacheIndex,
  forceDeleted = false,
}: CacheHitRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const canLoadEntry = entry.stored && !forceDeleted;
  const cacheEntryPayload = useMemo(
    () =>
      canLoadEntry && expanded
        ? {
            namespace: entry.namespace,
            key: entry.key,
            ...(entry.storage === undefined ? {} : { storage: entry.storage }),
          }
        : null,
    [canLoadEntry, entry.key, entry.namespace, entry.storage, expanded],
  );
  const cacheEntryResult = cacheEntryStore.useItem(cacheEntryPayload);
  const cacheEntry = cacheEntryResult.data;
  const cacheEntryDeleted =
    forceDeleted || cacheEntryResult.status === 'deleted';

  const deleteAction = useActionFn(async () => {
    if (!canLoadEntry) return;
    if (!window.confirm('Delete this cached entry?')) return;
    setDeleteError(null);
    const errorMessage = await deleteCacheEntry({
      namespace: entry.namespace,
      key: entry.key,
      ...(entry.storage === undefined ? {} : { storage: entry.storage }),
    });
    setDeleteError(errorMessage);
  });

  function handleToggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
  }

  const ageLabel = formatCacheAge(entry);
  const storedAt = entry.storedAt ?? cacheEntry?.storedAt;
  const finalAttributes = cacheEntry?.recording.finalAttributes ?? null;
  const hasFinalAttributes =
    finalAttributes !== null && Object.keys(finalAttributes).length > 0;

  return (
    <>
      <Card>
        <HeaderButton
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
        >
          <Caret>{expanded ? <ChevronDown /> : <ChevronRight />}</Caret>
          <StatusChip
            hit={entry.action === 'hit'}
            added={entry.action === 'added'}
          >
            {getStatusLabel(entry)}
          </StatusChip>
          <TypeChip>{entry.source === 'span' ? 'SPAN' : 'VALUE'}</TypeChip>
          <HeaderName>{entry.name}</HeaderName>
          {phase.kind === 'scoring' ? (
            <OriginTag>({phase.scoreLabel})</OriginTag>
          ) : null}
          {entry.origin === 'caseRoot' ? (
            <OriginTag>(case root)</OriginTag>
          ) : null}
          <HeaderMeta>
            {cacheEntryDeleted ? <span>deleted</span> : null}
            {ageLabel !== null ? <span>{ageLabel}</span> : null}
            {entry.action === 'added' && entry.status === 'miss' ? (
              <span>created</span>
            ) : null}
            {entry.status === 'refresh' ? <span>refreshed</span> : null}
            {!entry.stored ? <span>not stored</span> : null}
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
              {storedAt !== undefined ? (
                <MetaItem>
                  <MetaLabel>STORED</MetaLabel>
                  <MetaValue>{formatTimestamp(storedAt)}</MetaValue>
                </MetaItem>
              ) : null}
              <MetaItem>
                <MetaLabel>STATUS</MetaLabel>
                <MetaValue>{entry.status}</MetaValue>
              </MetaItem>
              <MetaItem>
                <MetaLabel>KEY</MetaLabel>
                <MetaValue>{entry.key}</MetaValue>
              </MetaItem>
            </MetaRow>

            {cacheEntryResult.isLoading ? (
              <StatusMessage>
                <LoadingLine>Loading cached value</LoadingLine>
              </StatusMessage>
            ) : null}

            {!entry.stored ? (
              <StatusMessage>
                This cache operation executed without storing an entry.
              </StatusMessage>
            ) : null}

            {cacheEntryResult.error !== null ? (
              <ErrorMessage>
                Could not load cached value: {cacheEntryResult.error.message}
              </ErrorMessage>
            ) : null}

            {deleteError !== null ? (
              <ErrorMessage>
                Could not delete cached value: {deleteError}
              </ErrorMessage>
            ) : null}

            {cacheEntryDeleted ? (
              <StatusMessage>Cached entry deleted.</StatusMessage>
            ) : null}

            {cacheEntry !== null ? (
              <>
                {cacheEntry.debugKey !== undefined ? (
                  <SectionWrapper>
                    <SectionLabel>Raw cache key</SectionLabel>
                    <JsonViewer
                      value={cacheEntry.debugKey.rawKey}
                      compact
                      maxHeight="raw"
                      collapsed={4}
                    />
                  </SectionWrapper>
                ) : null}
                <SectionWrapper>
                  <SectionLabel>Cached return value</SectionLabel>
                  <JsonViewer
                    value={cacheEntry.recording.returnValue}
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
            {entry.stored ? (
              <BodyActions>
                <Button
                  variant="secondary"
                  leftIcon={<GitCompare />}
                  disabled={cacheEntryDeleted || currentRunId.length === 0}
                  onClick={() => setCompareOpen(true)}
                >
                  Compare raw key
                </Button>
                <Button
                  variant="danger"
                  leftIcon={<Trash2 />}
                  disabled={cacheEntryDeleted || deleteAction.isInProgress}
                  onClick={() => {
                    void deleteAction.call();
                  }}
                >
                  {cacheEntryDeleted ? 'Deleted' : 'Delete cache entry'}
                </Button>
              </BodyActions>
            ) : null}
          </Body>
        ) : null}
      </Card>
      {compareOpen ? (
        <CacheRawKeyCompareModal
          isOpen={compareOpen}
          currentEntry={entry}
          currentRunId={currentRunId}
          currentCaseKey={currentCaseKey}
          currentEvalKey={currentEvalKey}
          currentCacheIndex={currentCacheIndex}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
    </>
  );
}

function getStatusLabel(entry: CacheActivityEntry): string {
  if (entry.status === 'hit') return 'HIT';
  if (entry.action === 'notStored') return 'NOT STORED';
  if (entry.status === 'refresh') return 'REFRESHED';
  return 'ADDED';
}
