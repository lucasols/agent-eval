import { useEffect } from 'react';
import { styled } from 'vindur';
import { CaseDrawer } from '#src/components/CaseDrawer';
import { EmptyState } from '#src/components/EmptyState';
import { FolderView } from '#src/components/FolderView';
import { RunDrawer } from '#src/components/RunDrawer';
import { Sidebar } from '#src/components/Sidebar';
import { SingleEvalView } from '#src/components/SingleEvalView';
import { useSearchParams } from '#src/hooks/useSearchParams';
import { evalsStore, fetchEvals } from '#src/stores/evalsStore';
import { refetchHistory } from '#src/stores/historyStore';
import {
  runStore,
  syncCaseSelectionFromSearchParams,
  syncRunSelectionFromSearchParams,
} from '#src/stores/runStore';
import {
  selectionStore,
  syncSelectionFromSearchParams,
} from '#src/stores/selectionStore';
import { fetchWorkspaceConfig } from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
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

export function AppShell() {
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
    void fetchEvals();
    void refetchHistory();
    void fetchWorkspaceConfig();
  }, []);

  useEffect(() => {
    syncSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedEvalId, selectedFolderPath]);

  useEffect(() => {
    void syncCaseSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedCaseRunId, selectedCaseFromUrl]);

  useEffect(() => {
    void syncRunSelectionFromSearchParams(new URLSearchParams(search));
  }, [search, selectedRunFromUrl, selectedCaseRunId, selectedCaseFromUrl]);

  useEffect(() => {
    const eventSource = new EventSource('/api/evals/events');
    eventSource.addEventListener('discovery.updated', () => {
      void fetchEvals();
      void refetchHistory();
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <Root>
      <Sidebar />
      <MainPanel sideDrawerOpen={sideDrawerOpen}>
        <MainContentFrame sideDrawerOpen={sideDrawerOpen}>
          <MainContent />
        </MainContentFrame>
      </MainPanel>
      {selectedCaseId ? <CaseDrawer /> : null}
      {selectedRunId ? <RunDrawer /> : null}
    </Root>
  );
}

function MainContent() {
  const { selection } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
  }));
  const { evals, discoveryIssues } = evalsStore.useSelectorRC((s) => ({
    evals: s.evals,
    discoveryIssues: s.discoveryIssues,
  }));
  const folderPath = selection.kind === 'folder' ? selection.path : '';
  const issueBanner =
    discoveryIssues.length > 0 ? (
      <DiscoveryIssueBanner>
        {discoveryIssues.map((issue) => issue.message).join(' ')}
      </DiscoveryIssueBanner>
    ) : null;

  if (selection.kind === 'eval') {
    const ev = evals.find((e) => e.key === selection.id);
    if (!ev) return <PendingState />;
    return (
      <>
        {issueBanner}
        <SingleEvalView evalSummary={ev} />
      </>
    );
  }

  const inFolder = collectEvalsInFolder(evals, folderPath);

  return (
    <>
      {issueBanner}
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
