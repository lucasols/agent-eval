import { useEffect } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import { useSearchParams } from '../hooks/useSearchParams.ts';
import { evalsStore, fetchEvals } from '../stores/evalsStore.ts';
import { refetchHistory } from '../stores/historyStore.ts';
import {
  runStore,
  syncCaseSelectionFromSearchParams,
  syncRunSelectionFromSearchParams,
} from '../stores/runStore.ts';
import {
  selectionStore,
  syncSelectionFromSearchParams,
} from '../stores/selectionStore.ts';
import { collectEvalsInFolder } from '../utils/buildEvalTree.ts';
import { CaseDrawer } from './CaseDrawer.tsx';
import { EmptyState } from './EmptyState.tsx';
import { FolderView } from './FolderView.tsx';
import { RunDrawer } from './RunDrawer.tsx';
import { Sidebar } from './Sidebar.tsx';
import { SingleEvalView } from './SingleEvalView.tsx';

const Root = styled.div`
  ${inline({ align: 'stretch' })}
  height: 100vh;
  overflow: hidden;
  background: ${colors.bg.var};
`;

const MainPanel = styled.div`
  ${stack()}
  flex: 1;
  min-width: 0;
  overflow: hidden;
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

  useEffect(() => {
    void fetchEvals();
    void refetchHistory();
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
    });

    return () => {
      eventSource.close();
    };
  }, []);

  return (
    <Root>
      <Sidebar />
      <MainPanel>
        <MainContent />
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
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const folderPath = selection.kind === 'folder' ? selection.path : '';

  if (selection.kind === 'eval') {
    const ev = evals.find((e) => e.id === selection.id);
    if (!ev) return <PendingState />;
    return <SingleEvalView evalSummary={ev} />;
  }

  const inFolder = collectEvalsInFolder(evals, folderPath);

  return (
    <FolderView
      folderPath={folderPath}
      evals={inFolder}
    />
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
