import {
  StackTraceViewer,
  type StackFrameLocation,
} from '#src/components/StackTraceViewer';
import {
  DEFAULT_WORKSPACE_CONFIG,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';

export function ErrorStackTrace({
  stack,
  primaryLocation,
  openButtonLabel,
}: {
  stack: string | undefined;
  primaryLocation?: StackFrameLocation | undefined;
  openButtonLabel?: string | undefined;
}) {
  const workspaceRoot =
    workspaceConfigStore.useDocument().data?.workspaceRoot ??
    DEFAULT_WORKSPACE_CONFIG.workspaceRoot;

  return (
    <StackTraceViewer
      stack={stack}
      primaryLocation={primaryLocation}
      workspaceRoot={workspaceRoot}
      openButtonLabel={openButtonLabel}
    />
  );
}
