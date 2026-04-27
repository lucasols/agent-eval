import { Agentation } from 'agentation';
import { AppShell } from '#src/components/AppShell';

export function App() {
  return (
    <>
      <AppShell />
      {import.meta.env.DEV && <Agentation />}
    </>
  );
}
