import { Agentation } from 'agentation';
import { AppShell } from './components/AppShell.tsx';

export function App() {
  return (
    <>
      <AppShell />
      {process.env.NODE_ENV === 'development' && <Agentation />}
    </>
  );
}
