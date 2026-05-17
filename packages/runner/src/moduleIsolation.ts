import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { registerHooks } from 'node:module';
import { dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isolationParam = 'agent-evals-isolate';
const pathSegmentSeparatorPattern = /[\\/]+/;

export type ModuleIsolationContext = { key: string; workspaceRoot: string };

const isolationStorage = new AsyncLocalStorage<ModuleIsolationContext>();
const activeIsolationRoots = new Map<string, string>();
const clearedRequireCacheKeys = new Set<string>();
let hooksRegistered = false;
const requireFromRunner = createRequire(import.meta.url);
const agentPackageUrlBySpecifier = new Map(
  [
    '@ls-stack/agent-eval',
    '@agent-evals/sdk',
    '@agent-evals/shared',
    '@agent-evals/runner',
    '@agent-evals/runner/run-child',
  ].flatMap((specifier) => {
    try {
      return [
        [specifier, pathToFileURL(requireFromRunner.resolve(specifier)).href],
      ];
    } catch {
      return [];
    }
  }),
);
const agentPackageDirectoryPaths = [
  ...new Set(
    [...agentPackageUrlBySpecifier.values()].map((packageUrl) =>
      dirname(fileURLToPath(packageUrl)),
    ),
  ),
];

function isAgentEvalsPackageSpecifier(specifier: string): boolean {
  return (
    specifier === '@ls-stack/agent-eval' ||
    specifier === '@agent-evals/sdk' ||
    specifier === '@agent-evals/shared' ||
    specifier === '@agent-evals/runner' ||
    specifier.startsWith('@ls-stack/agent-eval/') ||
    specifier.startsWith('@agent-evals/sdk/') ||
    specifier.startsWith('@agent-evals/shared/') ||
    specifier.startsWith('@agent-evals/runner/')
  );
}

function getIsolationKeyFromParent(
  parentURL: string | undefined,
): string | null {
  if (!parentURL?.startsWith('file:')) return null;
  const value = new URL(parentURL).searchParams.get(isolationParam);
  return activeIsolationRoots.has(value ?? '') ? value : null;
}

function isIsolatableFile(url: URL, workspaceRoot: string): boolean {
  if (url.protocol !== 'file:') return false;

  return isIsolatableFilePath(fileURLToPath(url), workspaceRoot);
}

function isIsolatableFilePath(
  filePath: string,
  workspaceRoot: string,
): boolean {
  if (isAgentEvalsPackageFilePath(filePath)) return false;

  const relativePath = relative(workspaceRoot, filePath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    return false;
  }

  const segments = relativePath.split(pathSegmentSeparatorPattern);
  return !segments.includes('.agent-evals');
}

function isAgentEvalsPackageFilePath(filePath: string): boolean {
  return agentPackageDirectoryPaths.some((packageDirectoryPath) => {
    const packageRelativePath = relative(packageDirectoryPath, filePath);
    return (
      packageRelativePath === '' ||
      (!packageRelativePath.startsWith('..') &&
        !isAbsolute(packageRelativePath))
    );
  });
}

function addIsolationParam(url: string, key: string): string {
  const moduleUrl = new URL(url);
  if (moduleUrl.searchParams.get(isolationParam) === key) return url;
  moduleUrl.searchParams.set(isolationParam, key);
  return moduleUrl.href;
}

function registerModuleIsolationHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const agentPackageUrl = agentPackageUrlBySpecifier.get(specifier);
      if (agentPackageUrl !== undefined) {
        return { url: agentPackageUrl, shortCircuit: true };
      }

      const resolved = nextResolve(specifier, context);
      if (isAgentEvalsPackageSpecifier(specifier)) return resolved;

      const activeContext = isolationStorage.getStore();
      const inferredKey = getIsolationKeyFromParent(context.parentURL);
      const isolationKey = activeContext?.key ?? inferredKey;
      if (isolationKey === null) return resolved;

      const workspaceRoot =
        activeContext?.workspaceRoot ?? activeIsolationRoots.get(isolationKey);
      if (workspaceRoot === undefined) return resolved;

      const resolvedUrl = new URL(resolved.url);
      if (!isIsolatableFile(resolvedUrl, workspaceRoot)) return resolved;

      return {
        ...resolved,
        url: addIsolationParam(resolved.url, isolationKey),
      };
    },
  });
}

function clearWorkspaceRequireCacheOnce(context: ModuleIsolationContext): void {
  if (clearedRequireCacheKeys.has(context.key)) return;
  clearedRequireCacheKeys.add(context.key);

  for (const filePath of Object.keys(requireFromRunner.cache)) {
    if (isIsolatableFilePath(filePath, context.workspaceRoot)) {
      delete requireFromRunner.cache[filePath];
    }
  }
}

/**
 * Execute module loading and eval code with fresh module URLs.
 *
 * Node does not expose an ESM cache reset API, so the runner appends a
 * scoped query parameter to workspace and dependency file imports. CommonJS
 * modules use `require.cache` behind ESM imports, so isolatable entries are
 * cleared once per scope. Agent Evals package imports are left alone so SDK
 * singletons, such as the eval registry, remain shared.
 */
export async function runWithModuleIsolation<T>(
  context: ModuleIsolationContext,
  fn: () => Promise<T>,
): Promise<T> {
  registerModuleIsolationHooks();
  clearWorkspaceRequireCacheOnce(context);
  activeIsolationRoots.set(context.key, context.workspaceRoot);
  return await isolationStorage.run(context, fn);
}
