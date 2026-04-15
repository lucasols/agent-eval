import { styled } from 'vindur';
import { inline, stack } from '#src/style/helpers';
import { fetchEvals } from '../stores/evalsStore.ts';
import { runStore } from '../stores/runStore.ts';
import { SidebarEvalList } from './SidebarEvalList.tsx';
import { RunToolbar } from './RunToolbar.tsx';
import { RunSummaryBar } from './RunSummaryBar.tsx';
import { ResultsTable } from './ResultsTable.tsx';
import { CaseDrawer } from './CaseDrawer.tsx';
import { useEffect } from 'react';

const Root = styled.div`
  ${inline()}
  height: 100vh;
  overflow: hidden;
`;

const MainPanel = styled.div`
  ${stack()}
  flex: 1;
  overflow: hidden;
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow: auto;
`;

export function AppShell() {
  const { selectedCaseId } = runStore.useSelectorRC((s) => ({
    selectedCaseId: s.selectedCaseId,
  }));

  useEffect(() => {
    void fetchEvals();
  }, []);

  return (
    <Root>
      <SidebarEvalList />
      <MainPanel>
        <RunToolbar />
        <RunSummaryBar />
        <ScrollArea>
          <ResultsTable />
        </ScrollArea>
      </MainPanel>
      {selectedCaseId ? <CaseDrawer /> : null}
    </Root>
  );
}
