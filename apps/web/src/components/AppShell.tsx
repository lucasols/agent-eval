import { useEffect } from 'react';
import { styled } from 'vindur';
import { LayoutGrid } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import { evalsStore, fetchEvals } from '../stores/evalsStore.ts';
import { refetchHistory } from '../stores/historyStore.ts';
import { runStore } from '../stores/runStore.ts';
import { selectionStore } from '../stores/selectionStore.ts';
import { Sidebar } from './Sidebar.tsx';
import { CaseDrawer } from './CaseDrawer.tsx';
import { SingleEvalView } from './SingleEvalView.tsx';
import { FolderView } from './FolderView.tsx';
import { EmptyState } from './EmptyState.tsx';
import { collectEvalsInFolder } from '../utils/buildEvalTree.ts';

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
  const { selectedCaseId } = runStore.useSelectorRC((s) => ({
    selectedCaseId: s.selectedCaseId,
  }));

  useEffect(() => {
    void fetchEvals();
    void refetchHistory();
  }, []);

  return (
    <Root>
      <Sidebar />
      <MainPanel>
        <MainContent />
      </MainPanel>
      {selectedCaseId ? <CaseDrawer /> : null}
    </Root>
  );
}

function MainContent() {
  const { selection } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
  }));
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));

  if (selection.kind === 'eval') {
    const ev = evals.find((e) => e.id === selection.id);
    if (!ev) return <PendingState />;
    return <SingleEvalView evalSummary={ev} />;
  }

  if (selection.kind === 'folder') {
    const inFolder = collectEvalsInFolder(evals, selection.path);
    return <FolderView folderPath={selection.path} evals={inFolder} />;
  }

  return (
    <EmptyState
      icon={<LayoutGrid />}
      title="Pick an eval"
      description="Select an eval from the sidebar to inspect its history, run it, and explore each case."
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

