# agent-eval

Local-first, UI-first eval tool for LLM/agent systems. Author evals in strict TypeScript inside `*.eval.ts` files, run them manually from a minimal UI or the CLI, and inspect trajectory, cost, and column-based inputs/outputs.

## Why

- **Real TypeScript evals** — author evals with `defineEval(...)`, normal TypeScript, scorers, and eval assertions.
- **Manual runs by default** — no background re-runs on file save. You trigger runs from the UI or CLI.
- **Cost + trace visibility** — per-case cost, token usage, a tree/detail view of the agent's trajectory, and custom result columns.
- **Formatted outputs** — keep outputs as plain values and control presentation from eval `columns`.

## Install

```sh
pnpm add -D @ls-stack/agent-eval
```

## Quick start

1. **Create `agent-evals.config.ts`** at your project root:

   ```ts
   import type { AgentEvalsConfig } from '@ls-stack/agent-eval';

   export const config: AgentEvalsConfig = {
     include: ['evals/**/*.eval.ts'],
     defaultTrials: 1,
     trialSelection: 'lowestScore',
     concurrency: 2,
     staleAfterDays: 14,
   };
   ```

2. **Write an eval** in `evals/my-agent.eval.ts`:

   ```ts
   import {
     appendToEvalOutput,
     defineEval,
     mergeEvalOutput,
     evalSpan,
     evalTracer,
     z,
   } from '@ls-stack/agent-eval';
   import { myAgent } from '../src/agent';

   defineEval({
     id: 'my-agent',
     title: 'My Agent',
     cases: [
       { id: 'greeting', input: { message: 'hello' } },
       { id: 'farewell', input: { message: 'bye' } },
     ],
     outputsSchema: z.object({ output: z.string() }),
     execute: async ({ input, setOutput }) => {
       await evalTracer.span({ kind: 'agent', name: 'my-agent' }, async () => {
         evalSpan.setAttribute('input', input);
         const output = await myAgent(input);
         evalSpan.setAttribute('output', output);
         setOutput('output', output);
         appendToEvalOutput('events', 'completed');
         mergeEvalOutput('metadata', { model: 'my-agent-v1' });
       });
     },
     scores: {
       hasOutput: ({ outputs }) => {
         return outputs.output.length > 0 ? 1 : 0;
       },
     },
   });
   ```

3. **Open the UI** — `agent-evals app` serves it at `http://localhost:4100` (override with `--port`). Use the sidebar status counts to filter visible evals by one or more states. On an eval page, filter the runs table by applicable result or recent-activity buckets, share that filter through the URL, and clear the currently filtered saved runs when needed. Each eval's actions menu can copy matching CLI run and debug commands using the workspace package manager.

4. **Or use the CLI**:

   ```sh
   agent-evals list
   agent-evals run
   agent-evals run --eval my-agent --case greeting --json
   agent-evals show-runs
   agent-evals show-runs latest --json
   agent-evals run --inspect --eval my-agent --case greeting
   ```

   Discovered eval file paths are shown relative to the active workspace root in both the CLI and UI.

   Use `agent-evals show-runs` to print saved run directories and stable artifact file paths. Run ids can be full timestamp ids, short ids such as `r0`, or `latest`.

   Run artifacts are persisted under `.agent-evals/runs/<run-id>/` with `run.json`, `summary.json`, per-case `cases.jsonl`, case detail JSON files, and trace JSON files for the executed cases.

A complete working example lives at [`examples/basic-agent`](./examples/basic-agent).

## Agent Skill

`@ls-stack/agent-eval` ships an [Agent Skills](https://agentskills.io/home)
skill. The published package includes
[`skills/agent-eval/SKILL.md`](./packages/cli/skills/agent-eval/SKILL.md).
After installation, symlink the bundled skill folder into your project's local
`skills/` directory:

```sh
mkdir -p skills
ln -s ../node_modules/@ls-stack/agent-eval/skills/agent-eval skills/agent-eval
```

For first-time installation, use
[`templates/agent-eval/install-prompt.md`](./templates/agent-eval/install-prompt.md)
instead — it is a one-off prompt template (not a skill) that walks an agent
through installing the package, creating `agent-evals.config.ts`, and wiring
convenience scripts.

## Module mocking

For true module replacement, use `mock.module(...)` from `node:test` and
register the mock before dynamically importing the module graph you want to
exercise.

Node requires the `--experimental-test-module-mocks` flag for this API, and the
Agent Evals CLI enables it automatically:

```sh
agent-evals run --eval module-mock-demo
```

Example:

```ts
import { mock } from 'node:test';
import { defineEval, evalAssert } from '@ls-stack/agent-eval';

defineEval({
  id: 'module-mock-demo',
  cases: [{ id: 'mocked-dependency', input: { customerId: 'vip-100' } }],
  execute: async ({ input, setOutput }) => {
    mock.module('../src/customerLookup.ts', {
      namedExports: {
        lookupCustomer: async () => ({ segment: 'vip' as const }),
      },
    });

    const { runWorkflow } = await );
    const result = await runWorkflow(input);

    setOutput('segment', result.segment);
    evalAssert(result.segment === 'vip', 'expected the mocked dependency');
  },
});
```

Notes:

- `isInEvalScope()` returns the current eval runner phase (`'env'`, `'cases'`, `'eval'`, `'derive'`, `'outputsSchema'`, or `'scorer'`) and returns `null` outside eval-owned work. This is useful when shared workflow code needs to branch on eval-only behavior. Top-level modules imported while a run is being prepared see `'env'`; code called from `execute` sees `'eval'`.
- `getEvalCaseInput()` returns the current case input while an eval case is executing, and `getEvalCaseInput('customer.tier')` reads nested values with dot-path access. Outside a case scope, both return `undefined`.
- `nextEvalId()` returns a stable sequential id for the active eval file, eval id, and case id, such as `refund-workflow-evals-refund-workflow-eval-ts-simple-text-1`. It throws outside an eval case scope so accidental production-only usage is visible.
- `evalAssert(...)` records a failed assertion only while an eval case scope is active. Outside a case scope, it is a no-op so shared workflow code can be reused safely.
- `evalLog(level, ...args)` records manual per-case logs shown in the case drawer's **Logs** tab. The runner also captures `console.log`, `console.info`, `console.warn`, and `console.error` during case-owned phases by default. Log arguments are stored as JSON-safe values and rendered with the JSON viewer, with a capped text preview and best-effort code location for collapsed rows; logs emitted inside cached operations are not replayed from cache hits.
- `mock.module(...)` only affects modules imported after the mock is registered.
- Use dynamic `import(...)` inside `execute`; static imports happen too early.
- The full working example is in [`examples/basic-agent/evals/support/playground/module-mock.eval.ts`](./examples/basic-agent/evals/support/playground/module-mock.eval.ts).

## Local development

From `examples/basic-agent`, run `pnpm eval app` for the same single-command flow a library user gets.

From the repo root, `pnpm dev` starts the example-backed Hono server on `http://localhost:5100` together with the Vite web dev server on `http://localhost:5200` by default, so frontend changes get full HMR while `/api` stays pointed at the example workspace. These repo-local defaults intentionally differ from the packaged `agent-evals app` default of `http://localhost:4100`, so you can run this checkout alongside an app in another project.

If you want different local dev ports, add a repo-root `.env` file with one or both of these variables:

```sh
AGENT_EVALS_DEV_SERVER_PORT=5300
AGENT_EVALS_DEV_WEB_PORT=5400
```

`pnpm dev`, `pnpm dev:server`, and `pnpm dev:app` read `AGENT_EVALS_DEV_SERVER_PORT`, and the Vite dev server reads `AGENT_EVALS_DEV_WEB_PORT` while proxying `/api` to the configured backend port.

## Publishing

Only `@ls-stack/agent-eval` is published. The internal `@agent-evals/*`
workspace packages remain source-first development packages and are bundled into
the public CLI package with `tsdown`.

Use `pnpm publish:pkg` from the repo root to publish through `pkg-manager`.
The publish flow lints and builds the CLI package before publishing, and the CLI
build also bundles the web UI assets used by `agent-evals app`.

## Configuration

`agent-evals.config.ts` at your project root defines how evals are discovered and executed.

| Field            | Type                            | Description                                                                           |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| `include`        | `string[]`                      | Glob patterns for eval files (e.g. `['evals/**/*.eval.ts']`)                          |
| `workspaceRoot`  | `string?`                       | Root directory; defaults to `process.cwd()`                                           |
| `defaultTrials`  | `number?`                       | Trials per case when not overridden (default: `1`)                                    |
| `trialSelection` | `'lowestScore' \| 'median'?`    | Winner selection strategy for persisted multi-trial case results                      |
| `concurrency`    | `number?`                       | Max parallel case executions per run, including trials (default: `2`)                 |
| `staleAfterDays` | `number?`                       | Days before a mismatched-commit latest run is marked outdated (default: `14`)         |
| `allowCliRunAll` | `boolean?`                      | Allow unfiltered `agent-evals run` to run every eval (default: `false`)               |
| `traceDisplay`   | `TraceDisplayConfig?`           | Global trace attribute display config for the UI                                      |
| `llmCalls`       | `LlmCallsConfig?`               | LLM calls tab config for the case-run drawer (kinds, attribute paths, custom metrics) |
| `apiCalls`       | `ApiCallsConfig?`               | API calls tab config for the case-run drawer (kinds, attribute paths, custom metrics) |
| `runLogs`        | `{ captureConsole?: boolean }?` | Case log capture config; set `captureConsole: false` to stop persisting console calls |

When `trials > 1`, the runner executes the case repeatedly but persists a
single winning result per case. `lowestScore` is the default. `median` uses the
lower median when the number of trials is even.

By default, CLI runs require explicit targeting with `--eval` or `--case`. Set
`allowCliRunAll: true` to permit unfiltered `agent-evals run`. The web UI can
still start grouped runs; when a UI action would run more than five evals, it
asks for confirmation first.

Case run logs are stored on each case detail and rendered as a **Logs** tab
with a phase filter for execute, derive, output schema validation, and scorer
logs. Use `evalLog('info', 'message %s', id)` for intentional eval notes. Each
entry stores the original arguments as JSON-safe values so objects and arrays
remain inspectable when the row is expanded. When Node provides stack frame
data, entries also include the source file, line, and column for the log call.
Console capture can be disabled globally:

```ts
export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  runLogs: { captureConsole: false },
};
```

## Writing evals

`defineEval` takes a single definition object:

| Field                   | Required   | Purpose                                                                         |
| ----------------------- | ---------- | ------------------------------------------------------------------------------- |
| `id`                    | yes        | Unique eval id                                                                  |
| `title`                 |            | Display title (defaults to a humanized version of `id`)                         |
| `cases`                 | yes        | `EvalCase[]` or `() => Promise<EvalCase[]>` (async loader for dynamic datasets) |
| `execute`               | yes        | `async ({ input }) => { ... }`                                                  |
| `outputsSchema`         | `TOutputs` | Zod schema that validates and types collected outputs before scoring            |
| `traceDisplay`          |            | Per-eval trace attribute display overrides for the UI                           |
| `waitForBackgroundJobs` |            | Set `false` to skip waiting for registered background work before finalization  |
| `deriveFromTracing`     |            | Derive output columns from the finished trace tree                              |
| `scores`                |            | Record of scoring functions returning `0..1`                                    |
| `columns`               |            | Custom columns shown in the results table                                       |
| `stats`                 |            | Opt-in stats row on the eval page (see [Stats row](#stats-row))                 |
| `charts`                |            | Opt-in history charts on the eval page (see [History charts](#history-charts))  |

### Cases

```ts
cases: [
  { id: 'simple-text', input: { message: 'I want a refund', locale: 'en-US' } },
];
```

If you omit `cases` entirely, or resolve them to `[]`, the runner still executes
the eval once with a synthetic empty-object input and a generated case id.

`columns` populates your custom columns.

### Execute and tracing

Wrap work in `evalTracer.span(...)` to get a trajectory tree in the UI. Span mutation is ambient, so helpers deeper in your call stack can write to the current span without threading a callback-local handle through your code:

```ts
execute: async ({ input, setOutput }) => {
  await evalTracer.span({ kind: 'agent', name: 'refund-agent' }, async () => {
    evalSpan.setAttribute('input', input);
    const result = await agent(input);
    evalSpan.appendToAttribute('events', 'agent-finished');
    evalSpan.mergeAttribute('summary', { status: result.status });
    evalSpan.setAttributes({ model: 'gpt-4.1', output: result });
    setOutput('output', result);
  });
  evalTracer.checkpoint('final-state', { approved: true });
};
```

Use `captureEvalSpanError(error)` for recoverable errors that should be visible
on the active span without aborting the case. Pass multiple errors either as
additional arguments or as an array; the span is marked `error`, and the detail
panel shows a dedicated captured-errors block with timing relative to the span:

```ts
await evalTracer.span(
  { kind: 'tool', name: 'load-optional-signals' },
  async () => {
    try {
      await loadOptionalSignals();
    } catch (error) {
      captureEvalSpanError(error);
      evalSpan.setAttribute('fallback', 'rule-based-signals');
    }
  },
);
```

Pass `'warning'` (or `{ level: 'warning' }`) as the final argument when the
diagnostic should be visible but should not mark the span as errored:

```ts
captureEvalSpanError(new Error('Optional signal is stale'), 'warning');
```

If a span callback throws, Agent Evals automatically marks that span as `error`,
attaches the thrown error to it, and rethrows so the case errors:

```ts
await evalTracer.span({ kind: 'tool', name: 'submit-refund' }, async () => {
  const result = await submitRefund(input);
  if (!result.accepted) {
    throw new Error(`Refund API rejected ${input.orderId}`);
  }
  return result;
});
```

Fire-and-forget spans started during `execute` are awaited before outputs,
`deriveFromTracing`, scores, and trace data are finalized. This makes started
background spans safe to launch without awaiting when the span result itself is
not needed:

```ts
execute: () => {
  void evalTracer.span(
    { kind: 'tool', name: 'warm-related-context' },
    async () => {
      await warmRelatedContext();
    },
  );
};
```

For non-span work, register the promise explicitly. The runner only waits for
settlement; any rejection behavior remains normal for the promise or the spans
inside it:

```ts
startEvalBackgroundJob(refreshSearchIndex());
```

Set `waitForBackgroundJob: false` on a span when it should not delay case
finalization, or `waitForBackgroundJobs: false` on an eval when none of its
registered background work should delay finalization.

Span `kind` values are open-ended strings. The UI assigns colors
automatically to every kind used during the app session, so external tracing
adapters can preserve native categories like `mastra.workflow.step` instead of
collapsing everything into the built-in `agent`, `llm`, `tool`, `retrieval`,
`scorer`, `checkpoint`, or `custom` kinds.

For observability systems that already emit span lifecycle events, use the
external span API. This lets an adapter translate start/update/end events into
the same eval trace tree without wrapping work in a callback:

```ts
const span = evalTracer.startSpan({
  id: exportedSpan.id,
  parentId: exportedSpan.parentSpanId ?? null,
  kind: 'llm',
  name: exportedSpan.name,
  startedAt: exportedSpan.startTime,
  attributes: exportedSpan.attributes,
});

evalTracer.updateSpan({
  id: span.id,
  attributes: { usage: exportedSpan.attributes?.usage },
});

span.end({
  endedAt: exportedSpan.endTime,
  attributes: { output: exportedSpan.output },
});
```

Use `evalTracer.recordSpan(...)` when the upstream system only exposes completed
spans.

By default, the UI automatically promotes only the `input` and `output` span
attributes. Use `traceDisplay` to promote any other span attributes in the trace
tree and detail pane:

```ts
traceDisplay: {
  attributes: [
    { path: 'input', label: 'Input', format: 'json', placements: ['section'] },
    { path: 'output', label: 'Output', format: 'json', placements: ['section'] },
    { path: 'model', label: 'Model', placements: ['detail'] },
    {
      path: 'usage.inputTokens',
      label: 'Input tokens',
      format: 'number',
      placements: ['tree', 'detail'],
      scope: 'subtree',
      mode: 'sum',
    },
    {
      key: 'compactInputTokens',
      path: 'usage.inputTokens',
      label: 'Compact input tokens',
      format: 'number',
      numberFormat: { notation: 'compact' },
      placements: ['detail'],
      scope: 'subtree',
      mode: 'sum',
    },
  ],
}
```

Use `key` when you want to display the same source attribute more than once, such as raw and compact views of the same token count. `transform` runs in the runner and the UI receives the transformed result as plain data.

`scope` controls whether a value is read from the current span only (`'self'`) or from the whole span subtree (`'subtree'`). `mode` controls how multiple matching values are resolved: `'all'`, `'last'`, or `'sum'`.

### LLM calls tab

The case-run drawer surfaces a dedicated **LLM calls** tab that derives a focused list from the trace whenever a case run produced at least one matching span. By default, every span with `kind: 'llm'` is treated as an LLM call and the tab reads `model`, `usage.inputTokens`, `usage.outputTokens`, `usage.cachedInputTokens`, `usage.reasoningTokens`, `costUsd`, `steps`, `finishReason`, `provider`, `input`, `output`, `reasoning`, and `toolCalls` from the span's attributes. Each row is collapsed by default; clicking expands it to show a per-token-type tokens + cost breakdown table, finish reason, input/output JSON, reasoning text, tool calls, and any custom metrics.

The expanded breakdown table includes separate **Cache write** and **Cache read** rows so providers like Anthropic — which charge a premium for cache creation (1.25× / 2× the base input rate) and a deep discount on cache reads (0.1×) — show up correctly. By default the table reads tokens from `usage.cacheCreationInputTokens` and `usage.cachedInputTokens`, and per-token-type costs from `cost.inputUsd`, `cost.outputUsd`, `cost.cacheCreationInputUsd`, `cost.cachedInputUsd`, and `cost.reasoningUsd` — record those alongside `costUsd` in your span attributes (or override the paths via `attributes.inputCost` / `outputCost` / `cacheCreationInputCost` / `cachedInputCost` / `reasoningCost`).

Override the defaults globally from `agent-evals.config.ts`:

```ts
llmCalls: {
  // Treat additional span kinds as LLM calls.
  kinds: ['llm', 'ai-sdk.generateText'],
  // Read structured fields from non-default attribute paths.
  attributes: {
    cachedInputTokens: 'usage.cache_read_input_tokens',
    reasoningTokens: 'usage.completion_tokens_details.reasoning_tokens',
  },
  // Surface arbitrary user metrics on each call. `placements` defaults to
  // `['body']`; include `'header'` to also show a chip on the collapsed row.
  metrics: [
    {
      label: 't/s',
      tooltip: 'Tokens per second', // shown on hover
      path: 'tokensPerSecond',
      format: 'number',
      numberFormat: { decimalPlaces: 1 },
      placements: ['header', 'body'],
    },
    { label: 'Retries', path: 'retryCount', format: 'number' },
    { label: 'Temperature', path: 'params.temperature', format: 'number' },
    { label: 'Streamed', path: 'streamed', format: 'boolean' },
  ],
}
```

Custom metrics support `'string' | 'number' | 'duration' | 'json' | 'boolean'` formats. Use `tooltip` to add a hover description for compact labels. The tab is hidden automatically for cases with no matching spans.

### API calls tab

The case-run drawer also surfaces an **API calls** tab whenever a case trace
contains matching API/HTTP spans. By default, spans with `kind: 'api'`,
`'http'`, `'http.client'`, or `'fetch'` are treated as API calls. The tab reads
`method`, `url`, `statusCode`, `request`, `response`, `requestBody`,
`responseBody`, `headers`, `durationMs`, and `error` from span attributes. Each
row is collapsed by default; clicking expands it to show captured request and
response payloads, headers, error payloads, warnings, and custom metrics.

Emit API calls as normal trace spans:

```ts
evalTracer.recordSpan({
  kind: 'api',
  name: 'fetch-support-routing-config',
  attributes: {
    method: 'GET',
    url: 'https://support-config.local/queues/gold',
    statusCode: 200,
    durationMs: 12,
    request: { customerTier: 'gold' },
    response: { queue: 'priority-refunds' },
    headers: { 'x-config-version': '2026-04' },
  },
});
```

Override the defaults globally from `agent-evals.config.ts`:

```ts
apiCalls: {
  // Treat additional span kinds as API calls.
  kinds: ['api', 'http.client', 'undici.request'],
  // Read structured fields from non-default attribute paths.
  attributes: {
    statusCode: 'http.status_code',
    durationMs: 'timing.totalMs',
  },
  metrics: [
    {
      label: 'Retries',
      path: 'retryCount',
      format: 'number',
      placements: ['header', 'body'],
    },
  ],
}
```

Custom metrics support the same `'string' | 'number' | 'duration' | 'json' |
'boolean'` formats and `['header' | 'body']` placements as LLM-call metrics.
The tab is hidden automatically for cases with no matching API spans.

### Scorers

```ts
scores: {
  mentionsRefund: {
    label: 'Mentions Refund',
    passThreshold: 1,
    compute: ({ outputs }) =>
      typeof outputs.output === 'string' && /refund/i.test(outputs.output)
        ? 1
        : 0,
  },
  reviewConfidence: {
    label: 'Review Confidence',
    // no passThreshold — purely informational
    compute: ({ outputs }) => sampleReviewConfidence(outputs),
  },
}
```

Every score is a first-class column in the run table, rendered per case and as
the per-run average. Scores are **not** combined into a single average — each
column stands on its own.

Pass/fail is per-score: a case fails if any score that declares a
`passThreshold` falls below that threshold (or if an assertion failed, or the
case errored). A run fails if any of its cases fail. Scores without
`passThreshold` are purely informational and never gate pass/fail. Hover a
score column in the UI to see its threshold.

Scores can choose a numeric visualization with `format`. In addition to the
standard numeric formats, score columns support `format: 'passFail'` and
`format: 'stars'`:

```ts
scores: {
  automatedQuality: {
    label: 'Automated Quality',
    format: 'stars',
    maxStars: 5,
    compute: ({ outputs }) => scoreQuality(outputs),
  },
}
```

Score functions run in their own trace scope, separate from the execution
trace used by `deriveFromTracing`. That means LLM-as-judge scorers can use
`evalTracer.span(...)` and cached spans without adding judge activity to agent
trajectory metrics:

```ts
scores: {
  judgeQuality: {
    label: 'Judge Quality',
    passThreshold: 0.8,
    compute: async ({ input, outputs }) => {
      const score = await evalTracer.span(
        {
          kind: 'scorer',
          name: 'llm-judge',
          cache: {
            key: {
              prompt: input.message,
              response: outputs.output,
              rubricVersion: 1,
            },
          },
        },
        async () => {
          const verdict = await judgeWithLlm(input.message, outputs.output);
          evalSpan.setAttributes({
            model: verdict.model,
            reasoning: verdict.reasoning,
          });
          incrementEvalOutput('costUsd', verdict.costUsd);
          return verdict.score;
        },
      );

      return typeof score === 'number' ? score : 0;
    },
  },
}
```

The case detail UI shows execution spans on the **Trace** tab and score spans
on a separate **Scoring** tab. Outputs recorded inside a scorer scope stay
private to that score.

Manual scores are separate from computed `scores`. They are created as pending
score columns during a run, then filled directly in the web UI. Values are
stored as normalized `0..1` numbers. While the latest run for an eval has any
pending manual scores, the eval is shown as `unscored`; older runs do not affect
that state.

```ts
manualScores: {
  reviewerDecision: {
    label: 'Reviewer Decision',
    format: 'passFail',
    passThreshold: 0.5,
  },
  reviewerQuality: {
    label: 'Reviewer Quality',
    format: 'stars',
    maxStars: 5,
  },
}
```

### Custom columns

```ts
columns: {
  locale: { label: 'Locale' },
  toolCalls: { label: 'Tool Calls', format: 'number' },
  previewCard: { label: 'Preview Card', format: 'image', hideInTable: true },
}
```

Populate values in `deriveFromTracing(...)` and/or from runtime outputs.
Long custom column text is truncated in the runs table and reveals the full value on hover.
Use `hideInTable: true` for rich outputs that should stay in the case detail view
without taking up space in the runs table.

### Stats row

The eval page can show a stats row at the top of each eval card. This is
**opt-in**: when `stats` is omitted (or empty) the row is not rendered. Set
`stats` to declare which stats appear, including score and numeric output
columns:

```ts
stats: [
  { kind: 'cases' },
  { kind: 'passRate', accent: true },
  {
    kind: 'column',
    key: 'matchesGoldAnswer',
    aggregate: 'avg',
    format: 'percent',
  },
  {
    kind: 'column',
    key: 'costUsd',
    label: 'Cost',
    aggregate: 'sum',
    format: 'number',
  },
  { kind: 'duration' },
];
```

Supported kinds:

- `cases` — declared case count.
- `passRate` — latest run's `passed/total`. Set `accent: true` to tint the value.
- `duration` — latest run's total duration.
- `cost` — latest run's summary cost in USD, when a run summary contains one.
- `column` — aggregate a score or numeric output column across the latest
  run's cases. `key` matches a score key or output column key. `aggregate` is
  `avg | min | max | sum | last`. `label` and `format` default to the matching
  column definition. Only finite numeric values participate; if none exist the
  stat renders an em dash.

### History charts

The eval page can render one or more history charts at the top of each eval
card that trend across the last 20 completed runs. Charts are **opt-in**:
when `charts` is omitted (or empty) no chart is rendered.

```ts
charts: [
  {
    heading: 'Scores',
    type: 'line',
    metrics: [
      { source: 'builtin', metric: 'passRate', color: 'accent' },
      {
        source: 'column',
        key: 'randomScore',
        aggregate: 'avg',
        color: 'accentDim',
      },
      {
        source: 'column',
        key: 'randomValue',
        aggregate: 'avg',
        color: 'warning',
        axis: 'right',
      },
    ],
    yDomain: { left: { min: 0, max: 1 }, right: { min: 0, max: 1 } },
    tooltipExtras: [{ source: 'column', key: 'costUsd', aggregate: 'sum' }],
  },
  {
    heading: 'Cost per run',
    type: 'area',
    metrics: [
      { source: 'column', key: 'costUsd', aggregate: 'sum', color: 'warning' },
    ],
  },
];
```

Each chart declares:

- `type` — `area`, `line`, or `bar`.
- `metrics` — one or more plotted series. `builtin` metrics (`passRate`,
  `cost`, `durationMs`) come from the per-run summary. `column` metrics
  aggregate a score or numeric `setEvalOutput` column across the run using an
  `aggregate` reducer: `avg | sum | min | max | latest | passThresholdRate`.
  `passThresholdRate` requires a score column with `passThreshold` — it
  reports the fraction of cases whose value met the threshold.
- `heading` (optional) — label shown above the chart.
- `axis` (`'left' | 'right'`) per metric enables a dual-axis chart.
- `yDomain` — per-axis `{ min, max }`. Omit for automatic scaling.
- `color` — semantic token: `accent | accentDim | success | error | warning | cost | textMuted`.
- `tooltipExtras` — extra metrics shown only on hover.

## Caching costly operations

Wrap a costly span (LLM call, remote tool, etc.) with `cache: { key }` to skip
execution on subsequent runs. The cache records every observable effect inside
the span — sub-spans, checkpoints, output helper calls, final attributes — and
replays them verbatim on hits, so traces and outputs look identical to a fresh
run.

```ts
await evalTracer.span(
  {
    kind: 'llm',
    name: 'plan-refund',
    cache: { key: { prompt: input.message, model: 'gpt-4o-mini' } },
  },
  async () => {
    const result = await llm.complete(input.message);
    evalSpan.setAttributes({ model: 'gpt-4o-mini', output: result });
    incrementEvalOutput('costUsd', computeCost(result));
    appendToEvalOutput('llmCalls', { model: 'gpt-4o-mini' });
    return result;
  },
);
```

Cached spans get `cache.status` in their attributes (`hit`, `miss`, `refresh`,
or `bypass`) plus `cache.key`, `cache.storedAt`, and `cache.age` (on hit).
These show as coloured badges in the trace tree.

Use `evalTracer.cache(...)` when you want the same cache behavior without
creating a wrapper span:

```ts
const receiptContext = await evalTracer.cache(
  {
    name: 'receipt-audit-context',
    key: { orderId: input.orderId, totalUsd: input.expectedTotalUsd },
  },
  async () => {
    const context = await loadReceiptContext(input);
    evalSpan.setAttribute('receiptContext', context);
    return context;
  },
);
```

If `evalTracer.cache(...)` runs inside an active span, that span receives a
`cache.refs` array entry like `{ type: 'value', name, namespace, key, status }`
with `storedAt` and `age` on hits. When `evalTracer.cache(...)` is called
directly from the case body (no surrounding `traceSpan`), the same ref is
recorded on the case detail's `cacheRefs` array instead — so spanless value
caches still surface in the UI. The cache call itself does not create a trace
span. SDK-mediated effects inside the callback still replay on hits, including
nested spans, checkpoints, output helper calls, and active span attributes
changed by the callback.

The case-run drawer adds a **Cache** tab whenever a case run produced cache
hits or wrote new cache entries. Use the selector to show all cache activity,
only hits, or only new entries added by misses/refreshes. It lists every span-
and value-cache entry (including spanless ones tagged "case root") with
namespace, status, age when available, stored-at timestamp when known, and
truncated key. Each row expands to fetch the persisted entry from
`GET /api/cache/:namespace/:key` and render its cached `returnValue` (and any
replayed span attributes) inline. When raw-key debug metadata is available, the
expanded row also shows the authored cache key. Use the row's delete action to
remove that single persisted cache entry. Bypasses remain visible inline as
per-span badges in the **Trace** tab because they do not write cache entries.

### Cache controls

CLI:

- `--cache <use|bypass|refresh>` — mode for this run (default `use`).
- `--no-cache` — shortcut for `--cache bypass`.
- `--refresh-cache` — shortcut for `--cache refresh`.
- `--clear-cache` — wipe cache entries before the run starts.
- `pnpm eval cache list` — dump persisted entries (add `--json` for JSON).
- `pnpm eval cache clear --eval <id>` — drop entries for one eval.
- `pnpm eval cache clear --all` — drop every entry.

UI: every `EvalCard` has a split button next to **Run** with a chevron menu
containing the same four run modes plus a danger-toned "Clear cache for this
eval". While a run is active, eval cards, folder headers, and the run drawer
show **Stop** to cancel the whole in-flight run by terminating its isolated
run process.

Server API (`/api/cache`):

- `GET /api/cache` — list entries.
- `GET /api/cache/:namespace/:key` — return one cache entry, plus optional
  raw-key debug metadata when available.
- `DELETE /api/cache` — clear everything.
- `DELETE /api/cache/:namespace` — clear one namespace.
- `DELETE /api/cache/:namespace/:key` — drop a single entry.

### How it works

- Default namespace is `${evalId}__${spanName}` for cached spans and
  `${evalId}__${name}` for spanless value caches; override per-call with
  `cache.namespace` / `namespace` to share entries across operations.
- Shared namespaces still include the eval file `codeFingerprint` in the final
  cache key. In practice, that means shared namespaces are reusable across
  evals in the same source file; evals in different files intentionally miss
  even when they use the same namespace and key.
- Entries live in inspectable per-owner files at
  `<workspaceRoot>/.agent-evals/cache/<owner>.json`; for default namespaces,
  the owner is the eval id.
- Authored raw cache keys are stored for debugging in
  `<workspaceRoot>/.agent-evals/cache-debug/<owner>.json`. This folder may
  contain prompts, user inputs, or other sensitive data, is not needed for cache
  reuse, and should be gitignored. Normal cache files remain hash-only.
- Each namespace keeps at most `cache.maxEntriesPerNamespace ?? 100` entries,
  pruning the oldest entries in that namespace on write so committed caches do
  not grow forever. Use `cache.maxEntriesByNamespace` for exact namespace
  overrides.
- Cache keys should be deterministic primitives, arrays, and plain objects.
  `Buffer`, `ArrayBuffer`, and typed-array values are serialized by a sha256 of
  their bytes. Native `Blob`/`File` keys use stable metadata by default
  (`type`, `size`, plus `name`/`lastModified` for `File`) and do not read file
  bytes. Add `serializeFileBytes: true` to a cached span or
  `evalTracer.cache(...)` call when byte-level cache invalidation is required.
- The cache key folds in a `codeFingerprint` — the sha256 of the eval file's
  source — so editing the eval produces a miss instead of a stale hit.
- Modes: `bypass` never reads or writes; `refresh` skips the read and always
  writes; `use` reads on hit and writes on miss.
- Multi-trial runs isolate cache writes per trial attempt and only flush the
  winning trial's writes into the shared cache, so later trials in the same run
  never reuse cache entries produced by earlier sibling trials.
- Only SDK-mediated side effects replay (`evalTracer.span`,
  `evalTracer.checkpoint`, output helper calls, span attributes). External side
  effects (network, DB writes) do _not_ replay on cache hits — use caching only
  for pure functions of their key.
- Cached payloads are serialized with Seroval's Web API plugin set, so return
  values and recorded SDK effects preserve richer built-ins such as `Date`,
  `Map`, `Set`, typed arrays, `URL`, `Headers`, `Blob`, and `File` on cache
  hits. Cache keys still use the deterministic key-hashing rules above.

Disable caching globally from `agent-evals.config.ts`:

```ts
export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  cache: { enabled: false },
};
```

You can also tune cache retention globally per namespace or for specific
namespaces:

```ts
export const config: AgentEvalsConfig = {
  include: ['evals/**/*.eval.ts'],
  cache: {
    maxEntriesPerNamespace: 50,
    maxEntriesByNamespace: { 'receipt-audit__receipt-audit-context': 200 },
  },
};
```

## Output formatting

Store output values with the `setOutput(...)` helper passed to `execute` as
plain data: strings, numbers, booleans, `null`, JSON-safe objects/arrays for
`format: 'json'`, explicit file refs, or native `Blob`/`File` values for
`format: 'image' | 'audio' | 'video' | 'file'`. When the eval has a typed
outputs generic, `setOutput(...)` keys and values are typed from that output
map. Use the global `setEvalOutput(...)` from shared workflow code that does
not receive the execute context. Use `incrementEvalOutput(...)` for numeric
totals, `appendToEvalOutput(...)` for arrays that preserve existing scalar
values, and `mergeEvalOutput(...)` for shallow object updates.

Add `outputsSchema` when you want runtime validation and typed scorer inputs.
The runner validates configured output fields after `execute` and
`deriveFromTracing`, before computed scores. For Zod object schemas, only
declared keys are passed to the schema; parsed schema fields are merged back
into the raw output map, so Zod defaults/transforms apply to configured fields
while unconfigured outputs are kept and displayed as before. Validation failures
mark the case as failed and skip computed scores. When you pass a narrowed
output type as the second generic, `outputsSchema` is required:
`defineEval<Input, z.infer<typeof outputsSchema>>({ outputsSchema, ... })`.

Use the eval `columns` option to control labels, authored column order,
alignment, visibility, and rendering format. Supported `columns.format` values
include `boolean`, `markdown`, `json`, `image`, `audio`, `video`, `file`,
`percent`, `duration`, `number`, `passFail`, and `stars`.

For `format: 'number'`, use `numberFormat` to customize the display:

```ts
price: {
  label: 'Price',
  format: 'number',
  numberFormat: { prefix: '$', decimalPlaces: 2 },
}
```

`numberFormat.notation` also supports compact rendering for shorter displays:

```ts
requestCount: {
  label: 'Requests',
  format: 'number',
  numberFormat: { notation: 'compact', decimalPlaces: 1 },
}
```

This uses the runtime locale's compact number formatting, for example `1.2K`.

```ts
import { defineEval } from '@ls-stack/agent-eval';

defineEval({
  id: 'receipt-preview',
  columns: {
    response: { label: 'Response', format: 'markdown' },
    receipt: { label: 'Receipt', format: 'image', hideInTable: true },
    toolResult: { label: 'Tool Result', format: 'json' },
  },
  execute: ({ setOutput }) => {
    setOutput('response', 'Refund prepared for **order #123**.');
    setOutput(
      'receipt',
      new File([imageBytes], 'receipt-1.png', { type: 'image/png' }),
    );
    setOutput('toolResult', { matched: true, confidence: 0.93 });
  },
});
```

A full working example lives in
[`examples/basic-agent/evals/support/playground/format-gallery.eval.ts`](./examples/basic-agent/evals/support/playground/format-gallery.eval.ts).

## CLI

```
agent-evals <command> [flags]

Commands:
  app                        Start server with the UI (http://localhost:4100)
  list                       List discovered evals
  run                        Run targeted evals
  show-runs [id|latest]      Show saved run artifact file paths
  cache list                 List cached operation entries
  cache clear --eval <id>    Clear cache entries for one eval
  cache clear --all          Clear every cached entry

Flags:
  --eval <id[,id]>           Run specific evals only
  --case <id[,id]>           Run specific cases only
  --trials <n>               Override trials per case
  --inspect[=host:port]      Run with the Node.js inspector enabled
  --inspect-brk[=host:port]  Enable inspector and pause before startup
  --json                     Emit run summary, run file index, or cache listing as JSON
  --port <n>                 Server port (app, default: 4100)
  --cache <use|bypass|refresh>  Cache mode for this run (default: use)
  --no-cache                 Shortcut for --cache bypass
  --refresh-cache            Shortcut for --cache refresh
  --clear-cache              Clear the cache before starting the run
  --no-env                   Disable automatic .env loading
  --help, -h                 Show global or command-specific help
```

The CLI automatically loads `.env` from the current workspace before running a
command. Variables already set in the shell take precedence over `.env` values;
use `--no-env` to disable this loading for a single invocation.

`run` requires `--eval` or `--case` unless `allowCliRunAll: true` is set in
`agent-evals.config.ts`. It exits non-zero if any case fails or errors, making it CI-friendly.
Use `agent-evals <command> --help` to inspect command-specific flags without
starting work. Unknown help targets exit non-zero instead of falling back to
global help.

## Status

v1 — local-first, single-user. No cloud sync, dashboards, or collaboration in this version.
