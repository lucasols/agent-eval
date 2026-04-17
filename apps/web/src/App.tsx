import { Agentation } from 'agentation';
import { AppShell } from './components/AppShell.tsx';

export function App() {
  return (
    <>
      <AppShell />
      {import.meta.env.DEV && <Agentation />}
    </>
  );
}
