import { fileURLToPath } from 'node:url';
import type {
  CaseInputSection,
  EvalColumnOverride,
  EvalInputSectionConfig,
  EvalInputSectionObjectConfig,
  EvalInputSections,
  EvalInputSectionSelectFn,
} from '@agent-evals/shared';
import { getNestedAttribute } from '@agent-evals/shared';
import { resultify } from 't-result';
import { buildInputSectionDef, toCellValue } from './columnBuilder.ts';
import {
  persistInlineArtifact,
  persistLocalFileArtifact,
} from './outputArtifacts.ts';

type EvalCaseLike = { id: string; input: unknown; tags?: string[] };

type ResolveInputSectionsParams<TGlobalInput, TEvalInput> = {
  globalInputSections?: EvalInputSections<TGlobalInput>;
  evalInputSections?: EvalInputSections<TEvalInput>;
  input: unknown;
  evalCase: EvalCaseLike;
  artifactDir: string;
  runId: string;
  trial: number;
};

type CollectInputSectionsParams<TInput> = {
  inputSections: EvalInputSections<TInput> | undefined;
  sections: Map<string, CaseInputSection>;
  input: unknown;
  evalCase: EvalCaseLike;
  artifactDir: string;
  runId: string;
  trial: number;
};

type MaterializeInputSectionValueParams = {
  value: unknown;
  sectionKey: string;
  pathSegments: string[];
  evalCase: EvalCaseLike;
  artifactDir: string;
  runId: string;
  trial: number;
};

/** Resolve configured input sections into display-ready case detail entries. */
export async function resolveInputSections<TGlobalInput, TEvalInput>({
  globalInputSections,
  evalInputSections,
  input,
  evalCase,
  artifactDir,
  runId,
  trial,
}: ResolveInputSectionsParams<TGlobalInput, TEvalInput>): Promise<
  CaseInputSection[]
> {
  const sections = new Map<string, CaseInputSection>();
  await collectInputSections({
    inputSections: globalInputSections,
    sections,
    input,
    evalCase,
    artifactDir,
    runId,
    trial,
  });
  await collectInputSections({
    inputSections: evalInputSections,
    sections,
    input,
    evalCase,
    artifactDir,
    runId,
    trial,
  });
  return [...sections.values()];
}

async function collectInputSections<TInput>({
  inputSections,
  sections,
  input,
  evalCase,
  artifactDir,
  runId,
  trial,
}: CollectInputSectionsParams<TInput>): Promise<void> {
  if (inputSections === undefined) return;

  for (const [key, config] of Object.entries(inputSections)) {
    const section = await resolveOneInputSection({
      key,
      config,
      input,
      evalCase,
      artifactDir,
      runId,
      trial,
    });
    if (section === null) continue;
    sections.set(key, section);
  }
}

async function resolveOneInputSection<TInput>(params: {
  key: string;
  config: EvalInputSectionConfig<TInput>;
  input: unknown;
  evalCase: EvalCaseLike;
  artifactDir: string;
  runId: string;
  trial: number;
}): Promise<CaseInputSection | null> {
  const selector = getInputSectionSelector(params.config);
  if (selector === undefined) return null;

  const selected = await selectInputSectionValue({
    selector,
    input: params.input,
    evalCase: params.evalCase,
  });
  if (selected === undefined) return null;

  const materialized = await materializeInputSectionValue({
    value: selected,
    sectionKey: params.key,
    pathSegments: [],
    evalCase: params.evalCase,
    artifactDir: params.artifactDir,
    runId: params.runId,
    trial: params.trial,
  });
  const cell = await toCellValue(materialized);
  if (cell === undefined) return null;

  const override = getInputSectionOverride(params.config);
  const def = buildInputSectionDef({ key: params.key, value: cell, override });

  return { ...def, value: cell };
}

function getInputSectionSelector<TInput>(
  config: EvalInputSectionConfig<TInput>,
): string | EvalInputSectionSelectFn<TInput> | undefined {
  if (typeof config === 'string' || typeof config === 'function') {
    return config;
  }
  if (config.select !== undefined) return config.select;
  return config.path;
}

function getInputSectionOverride<TInput>(
  config: EvalInputSectionConfig<TInput>,
): EvalColumnOverride | undefined {
  if (!isInputSectionObjectConfig(config)) return undefined;

  return {
    label: config.label,
    format: config.format,
    numberFormat: config.numberFormat,
    maxStars: config.maxStars,
  };
}

function isInputSectionObjectConfig<TInput>(
  config: EvalInputSectionConfig<TInput>,
): config is EvalInputSectionObjectConfig<TInput> {
  return typeof config === 'object';
}

async function selectInputSectionValue<TInput>(params: {
  selector: string | EvalInputSectionSelectFn<TInput>;
  input: unknown;
  evalCase: EvalCaseLike;
}): Promise<unknown> {
  const selector = params.selector;
  if (typeof selector === 'string') {
    return getNestedAttribute(params.input, selector);
  }

  const result = await resultify(() =>
    callInputSectionSelector(selector, params.input, params.evalCase),
  );
  if (result.error) {
    return { error: `inputSections selector threw: ${result.error.message}` };
  }
  return result.value;
}

async function callInputSectionSelector<TInput>(
  fn: EvalInputSectionSelectFn<TInput>,
  input: unknown,
  evalCase: EvalCaseLike,
): Promise<unknown> {
  return await Reflect.apply(fn, undefined, [input, { case: evalCase }]);
}

async function materializeInputSectionValue({
  value,
  sectionKey,
  pathSegments,
  evalCase,
  artifactDir,
  runId,
  trial,
}: MaterializeInputSectionValueParams): Promise<unknown> {
  if (isBlob(value)) {
    return await persistInlineArtifact({
      artifactDir,
      runId,
      caseId: evalCase.id,
      outputKey: inputArtifactKey(sectionKey, pathSegments),
      trial,
      value,
    });
  }

  const filePath = localFileUrlPath(value);
  if (filePath !== null) {
    const artifact = await persistLocalFileArtifact({
      artifactDir,
      runId,
      caseId: evalCase.id,
      artifactKey: inputArtifactKey(sectionKey, pathSegments),
      trial,
      filePath,
    });
    return artifact ?? value;
  }

  if (Array.isArray(value)) {
    const materialized: unknown[] = [];
    for (const [index, item] of value.entries()) {
      materialized.push(
        await materializeInputSectionValue({
          value: item,
          sectionKey,
          pathSegments: [...pathSegments, String(index)],
          evalCase,
          artifactDir,
          runId,
          trial,
        }),
      );
    }
    return materialized;
  }

  if (isPlainRecord(value)) {
    const materialized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      materialized[key] = await materializeInputSectionValue({
        value: item,
        sectionKey,
        pathSegments: [...pathSegments, key],
        evalCase,
        artifactDir,
        runId,
        trial,
      });
    }
    return materialized;
  }

  return value;
}

function inputArtifactKey(sectionKey: string, pathSegments: string[]): string {
  return [sectionKey, ...pathSegments].join('-');
}

function localFileUrlPath(value: unknown): string | null {
  if (value instanceof URL) {
    return pathFromFileUrl(value);
  }
  if (typeof value !== 'string' || !value.startsWith('file://')) {
    return null;
  }

  const parsed = resultify(() => new URL(value));
  if (parsed.error) return null;
  return pathFromFileUrl(parsed.value);
}

function pathFromFileUrl(url: URL): string | null {
  if (url.protocol !== 'file:') return null;
  const pathResult = resultify(() => fileURLToPath(url));
  if (pathResult.error) return null;
  return pathResult.value;
}

function isBlob(value: unknown): value is Blob {
  return value instanceof Blob;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (value instanceof URL || value instanceof Blob) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
