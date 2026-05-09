import { configReloadStateSchema } from '@agent-evals/shared';
import { useEffect, useState } from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { z } from 'zod/v4';
import { CaseDrawer } from '#src/components/CaseDrawer';
import { EmptyState } from '#src/components/EmptyState';
import { FolderView } from '#src/components/FolderView';
import { GlobalModalHost } from '#src/components/GlobalModalHost';
import { RunDrawer } from '#src/components/RunDrawer';
import { Sidebar } from '#src/components/Sidebar';
import { SingleEvalView } from '#src/components/SingleEvalView';
import { useSearchParams } from '#src/hooks/useSearchParams';
import { dataStoreManager } from '#src/stores/dataStoreManager';
import {
  discoveryIssuesStore,
  evalSummariesStore,
  invalidateEvalResources,
} from '#src/stores/evalsStore';
import { invalidateRunHistory } from '#src/stores/historyStore';
import {
  clearRunStartError,
  runStore,
  syncCaseSelectionFromSearchParams,
  syncRunSelectionFromSearchParams,
} from '#src/stores/runStore';
import {
  selectionStore,
  syncSelectionFromSearchParams,
} from '#src/stores/selectionStore';
import {
  DEFAULT_WORKSPACE_CONFIG,
  setConfigReloadState,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import { apiUrl } from '#src/utils/apiUrl';
import { collectEvalsInFolder } from '#src/utils/buildEvalTree';

const Root = styled.div`
  ${inline({ align: 'stretch' })}
  height: 100vh;
  overflow: hidden;
  background: ${colors.bg.var};
`;

const MainPanel = styled.div<{ sideDrawerOpen: boolean }>`
  ${stack()}
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: hidden;

  &.sideDrawerOpen {
    overflow-x: auto;
  }
`;

const MainContentFrame = styled.div<{ sideDrawerOpen: boolean }>`
  width: 100%;
  height: 100%;

  &.sideDrawerOpen {
    min-width: 600px;
  }
`;

const DiscoveryIssueBanner = styled.div`
  padding: 10px 16px;
  border-bottom: 1px solid ${colors.error.alpha(0.22)};
  background: ${colors.error.alpha(0.08)};
  color: ${colors.error.var};
  font-size: 13px;
  line-height: 1.4;
`;

const RunStartErrorBanner = styled.div`
  ${inline({ justify: 'space-between', gap: 12 })}
  padding: 10px 16px;
  border-bottom: 1px solid ${colors.error.alpha(0.22)};
  background: ${colors.error.alpha(0.08)};
  color: ${colors.error.var};
  font-size: 13px;
  line-height: 1.4;
`;

const RunStartErrorMessage = styled.div`
  min-width: 0;
  overflow-wrap: anywhere;
`;

const DismissRunStartErrorButton = styled.button`
  border: 0;
  background: transparent;
  color: ${colors.error.var};
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
`;

const ConfigReloadBanner = styled.div`
  padding: 10px 16px;
  border-bottom: 1px solid ${colors.warning.alpha(0.24)};
  background: ${colors.warning.alpha(0.08)};
  color: ${colors.warning.var};
  font-size: 13px;
  line-height: 1.4;
`;

const configReloadEnvelopeSchema = z.object({
  payload: configReloadStateSchema,
});

export function AppShell() {
  const [showReloadApplied, setShowReloadApplied] = useState(false);
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { selectedCaseId, selectedRunId } = runStore.useSelectorRC((s) => ({
    selectedCaseId: s.selectedCaseId,
    selectedRunId: s.selectedRunId,
  }));
  const selectedEvalId = searchParams.get('eval');
  const selectedFolderPath = searchParams.get('folder');
  const selectedRunFromUrl = searchParams.get('run');
  const selectedCaseRunId = searchParams.get('caseRun');
  const selectedCaseFromUrl = searchParams.get('case');
  const sideDrawerOpen = selectedCaseId !== null || selectedRunId !== null;

  useEffect(() => {
    syncSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedEvalId, selectedFolderPath]);

  useEffect(() => {
    syncCaseSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedCaseRunId, selectedCaseFromUrl]);

  useEffect(() => {
    syncRunSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedRunFromUrl, selectedCaseRunId, selectedCaseFromUrl]);

  useEffect(() => {
    const eventSource = new EventSource(apiUrl('/api/evals/events'));
    let hasOpened = false;
    eventSource.addEventListener('open', () => {
      if (hasOpened) dataStoreManager.onTransportReconnect();
      hasOpened = true;
    });
    eventSource.addEventListener('discovery.updated', () => {
      invalidateEvalResources('realtimeUpdate');
      invalidateRunHistory('realtimeUpdate');
    });
    let appliedNoticeTimer: ReturnType<typeof setTimeout> | undefined;
    eventSource.addEventListener('config.reload', (event) => {
      const parsedJson = resultify((): unknown => JSON.parse(event.data));
      if (parsedJson.error) return;
      const parsed = configReloadEnvelopeSchema.safeParse(parsedJson.value);
      if (!parsed.success) return;
      const configReload = parsed.data.payload;
      setConfigReloadState(configReload);
      if (
        configReload.status !== 'idle' ||
        configReload.lastReloadedAt === null
      ) {
        return;
      }

      workspaceConfigStore.invalidateData('realtimeUpdate');
      invalidateEvalResources('realtimeUpdate');
      invalidateRunHistory('realtimeUpdate');
      setShowReloadApplied(true);
      if (appliedNoticeTimer !== undefined) clearTimeout(appliedNoticeTimer);
      appliedNoticeTimer = setTimeout(() => {
        setShowReloadApplied(false);
      }, 3000);
    });

    return () => {
      if (appliedNoticeTimer !== undefined) clearTimeout(appliedNoticeTimer);
      eventSource.close();
    };
  }, []);

  return (
    <Root>
      <Sidebar />
      <MainPanel sideDrawerOpen={sideDrawerOpen}>
        <MainContentFrame sideDrawerOpen={sideDrawerOpen}>
          <MainContent showReloadApplied={showReloadApplied} />
        </MainContentFrame>
      </MainPanel>
      {selectedCaseId ? <CaseDrawer /> : null}
      {selectedRunId ? <RunDrawer /> : null}
      <GlobalModalHost />
    </Root>
  );
}

function MainContent({ showReloadApplied }: { showReloadApplied: boolean }) {
  const { selection } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
  }));
  const workspaceConfigResult = workspaceConfigStore.useDocument();
  const configReload =
    workspaceConfigResult.data?.configReload ??
    DEFAULT_WORKSPACE_CONFIG.configReload;
  const { runStartError } = runStore.useSelectorRC((s) => ({
    runStartError: s.runStartError,
  }));
  const evalsResult = evalSummariesStore.useDocument();
  const discoveryIssuesResult = discoveryIssuesStore.useDocument();
  const evals = evalsResult.data ?? [];
  const discoveryIssues = discoveryIssuesResult.data ?? [];
  const evalLoadError =
    evalsResult.error?.message ?? discoveryIssuesResult.error?.message ?? null;
  const folderPath = selection.kind === 'folder' ? selection.path : '';
  const issueBanner =
    discoveryIssues.length > 0 ? (
      <DiscoveryIssueBanner>
        {discoveryIssues.map((issue) => issue.message).join(' ')}
      </DiscoveryIssueBanner>
    ) : null;
  const configReloadBanner =
    configReload.status === 'pending' ? (
      <ConfigReloadBanner>
        Config changed. Reload will apply after{' '}
        {String(configReload.activeRunCount)} running{' '}
        {configReload.activeRunCount === 1 ? 'run finishes' : 'runs finish'}.
      </ConfigReloadBanner>
    ) : configReload.status === 'reloading' ? (
      <ConfigReloadBanner>
        Config changed. Reloading app config.
      </ConfigReloadBanner>
    ) : showReloadApplied ? (
      <ConfigReloadBanner>Config reloaded.</ConfigReloadBanner>
    ) : null;
  const runStartErrorBanner =
    runStartError !== null ? (
      <RunStartErrorBanner>
        <RunStartErrorMessage>{runStartError}</RunStartErrorMessage>
        <DismissRunStartErrorButton onClick={clearRunStartError}>
          Dismiss
        </DismissRunStartErrorButton>
      </RunStartErrorBanner>
    ) : null;

  if (selection.kind === 'eval') {
    const ev = evals.find((e) => e.key === selection.id);
    if (!ev) {
      if (evalLoadError !== null && evals.length === 0) {
        return (
          <EmptyState
            title="Could not load evals"
            description={evalLoadError}
          />
        );
      }
      return <PendingState />;
    }
    return (
      <>
        {issueBanner}
        {configReloadBanner}
        {runStartErrorBanner}
        <SingleEvalView evalSummary={ev} />
      </>
    );
  }

  const inFolder = collectEvalsInFolder(evals, folderPath);

  if (evalLoadError !== null && evals.length === 0) {
    return (
      <EmptyState
        title="Could not load evals"
        description={evalLoadError}
      />
    );
  }

  return (
    <>
      {issueBanner}
      {configReloadBanner}
      {runStartErrorBanner}
      <FolderView
        folderPath={folderPath}
        evals={inFolder}
      />
    </>
  );
}

function PendingState() {
  return (
    <EmptyState
      title="Loading"
      description="Resolving the selected eval."
    />
  );
}
