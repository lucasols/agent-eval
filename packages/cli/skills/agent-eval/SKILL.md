---
name: agent-eval
description: Create, run, and maintain TypeScript evals with @ls-stack/agent-eval. Use when adding eval coverage for an LLM or agent workflow, updating *.eval.ts files, checking eval results, configuring agent-evals.config.ts, inspecting saved .agent-evals run artifacts, or wiring product source code with evalTracer spans.
---

# Agent Eval

Local-first, UI-first eval runner for LLM and agent systems. Evals are strict
TypeScript modules named `*.eval.ts`, discovered from `agent-evals.config.ts`,
and executed through the CLI (`agent-evals run`) or the web UI
(`agent-evals app`). Runs persist to `.agent-evals/` so results, traces, and
caches survive across processes.

This skill covers the mental model and conventions. For exhaustive field lists
(config options, eval shape, column formats, score/chart/stats options, trace
display rules), read the TypeScript declarations shipped with the package:

- `AgentEvalsConfig`, `EvalDefinition`, `EvalCase`, `EvalOutputs`,
  `EvalColumnOverride`, `EvalDeriveConfig`, `EvalScoreDef`,
  `EvalManualScoreDef`, `EvalTraceTree`, `TraceSpanInfo`, and `z` are exported
  from `@ls-stack/agent-eval`.
- `.d.ts` files land in `node_modules/@ls-stack/agent-eval/dist/`.
- CLI surface: `agent-evals --help` and `agent-evals <command> --help`.
  Unknown help targets exit non-zero instead of falling back to global help.
- The CLI automatically loads `.env` from the current workspace. Shell-provided
  environment variables win; pass `--no-env` to disable `.env` loading once.
- Unfiltered `agent-evals run` is disabled by default; use `--eval` or `--case`
  for targeted CLI runs, or `--tags-filter <expr>` to run cases matching tags.
  Set `allowCliRunAll: true` in
  `agent-evals.config.ts` to opt into run-all CLI behavior. The web UI can
  still run grouped evals and confirms before starting more than five. On a
  single eval page, the Run chevron can open a picker to run specific authored
  case ids; those case-picked runs are temporary by default and can be made
  durable in the modal.
- `agent-evals run --temporary` persists a run like normal history, but deletes
  it before the next run starts. Temporary runs appear in `show-runs` and the UI
  while present; normal runs are never deleted by temporary-run cleanup.
- `agent-evals app` watches `agent-evals.config.ts` and reloads config in
  place when the runner is idle. If config changes during an active run, the UI
  shows a pending reload banner and blocks new runs until the current run
  reaches a terminal state and the reload applies.

Assume that enumerated tables in this document may lag behind the types —
treat the types as source of truth when they disagree.

## Where tracing lives

**Tracing belongs in the product source code, not in the eval file.** The eval
file wires up cases and scoring; the real `evalTracer.span(...)` calls sit
inside the workflow, agent, or tool functions that both production and evals
invoke.

`evalTracer`, `evalSpan`, output helpers, `evalLog`, `evalAssert`, and
`evalExpect` are ambient no-ops when called outside an eval case scope, so
leaving them in
production paths is safe — they only record anything when the product code runs
inside an eval's `execute`. Use `isInEvalScope()` to branch on eval-only behavior in shared code
(e.g. skip a real network side effect): it returns `null` outside eval-owned
work and returns `'env'`, `'cases'`, `'eval'`, `'derive'`, `'outputsSchema'`, or
`'scorer'` during runner phases. Top-level modules imported while a run is being
prepared see `'env'`; code called from `execute` sees `'eval'`. Use
`getEvalCaseInput()` to read the current case input, or
`getEvalCaseInput('customer.tier')` for nested dot-path access; outside a case
scope it returns `undefined`. Use `nextEvalId()` inside eval-scoped code when a
stable generated id is needed; it includes the eval file, eval id, case id, and
a per-case sequence number, and throws outside an eval case scope.
Use `evalLog(level, ...args)` for intentional per-case logs. The runner also
captures `console.log`, `console.info`, `console.warn`, and `console.error`
during case-owned phases by default; log arguments are stored as JSON-safe
values and rendered with the JSON viewer, collapsed previews include best-effort
code locations when stack data is available, previews are capped, and logs
inside cached operations are not replayed from cache hits.
Use eval tags to target related coverage without naming every case:
`AgentEvalsConfig.tags` applies workspace-wide tags, `defineEval({ tags })`
adds eval tags, `case.tags` adds case-only tags, and `removeTags` disables a
configured global tag for one eval. CLI filters support Vitest-style tag
expressions such as `agent-evals run --tags-filter "refunds && !slow"`.
Inside eval-scoped code, use `matchesEvalTags('tag')` or
`matchesEvalTags({ all, any, not })`; it uses typed exact tag names and returns
`false` outside a case scope. Projects can narrow tag names with a `.d.ts`
module augmentation:

```ts
import '@ls-stack/agent-eval';

declare module '@ls-stack/agent-eval' {
  interface AgentEvalTagRegistry {
    tags: 'refunds' | 'media' | 'manual' | 'slow';
  }
}
```

### Product code (instrumented once, reused everywhere)

```ts
// src/workflows/refundWorkflow.ts
import {
  appendToEvalOutput,
  captureEvalSpanError,
  evalAssert,
  evalExpect,
  evalSpan,
  evalTracer,
  getEvalCaseInput,
  incrementEvalOutput,
  mergeEvalOutput,
  nextEvalId,
  setEvalOutput,
  startEvalBackgroundJob,
} from '@ls-stack/agent-eval';

export async function runRefundWorkflow(input: RefundInput) {
  return evalTracer.span(
    { kind: 'agent', name: 'refund-workflow' },
    async () => {
      evalSpan.setAttribute('input', input);

      const plan = await evalTracer.span(
        {
          kind: 'llm',
          name: 'plan-refund',
          cache: {
            namespace: 'refund-workflow__plan-refund',
            key: { prompt: input.message, model: 'gpt-4o-mini' },
          },
        },
        async () => {
          let text: string;
          let usage: { inputTokens: number; outputTokens: number };
          try {
            ({ text, usage } = await llm.complete(input.message));
          } catch (error) {
            captureEvalSpanError(error);
            ({ text, usage } = await llm.completeWithFallback(input.message));
          }
          evalSpan.setAttributes({
            model: 'gpt-4o-mini',
            provider: 'openai',
            usage,
          });
          const expectedLocale = getEvalCaseInput('locale');
          if (typeof expectedLocale === 'string') {
            evalSpan.setAttribute('expectedLocale', expectedLocale);
          }
          evalSpan.incrementAttribute('llmCalls', 1);
          evalSpan.appendToAttribute('models', 'gpt-4o-mini');
          return text;
        },
      );

      const result = await applyRefund(plan);
      const reviewId = nextEvalId();
      setEvalOutput('response', result.finalText);
      setEvalOutput('reviewId', reviewId);
      mergeEvalOutput('metadata', { approved: result.approved });
      evalAssert(result.approved, 'refund workflow should approve the case');
      evalExpect(result.finalText).toMatch(/refund/i);
      evalSpan.setAttribute('output', { result, reviewId });
      return result;
    },
  );
}
```

Span `kind` values are open-ended strings. Use familiar kinds such as
`agent`, `tool`, `llm`, `api`, `retrieval`, `scorer`, or `checkpoint` when they
fit, and preserve external tracer kinds such as `mastra.workflow.step` when they
are more specific. Only the `input` and `output` span attributes are promoted
automatically in the trace tree; use `traceDisplay` for other span attributes
such as `model` or `usage`. Eval-level LLM usage outputs, columns, stats, and
charts are derived from matching LLM spans by default. Prefer
`llmCalls.pricing` for LLM-call cost display; built-in costs ignore span
`costUsd` attributes.

Use `captureEvalSpanError(error)` for recoverable errors on the active
`evalTracer.span(...)`, such as optional model/tool failures that fall back and
continue. You can pass one error, multiple error arguments, or an array. The
span is still marked `error`. Pass `'warning'` or `{ level: 'warning' }` as the
final argument for diagnostics that should not change an otherwise successful
span's status.

If a span callback throws, the SDK automatically marks that span as `error`,
stores the thrown error on it, and rethrows so the case errors. Use that for
terminal failures; use `captureEvalSpanError(...)` for recoverable failures that
continue through fallback logic.

Fire-and-forget spans started during `execute` are awaited before outputs,
`deriveFromTracing`, scores, and trace data are finalized, so `void
evalTracer.span(...)` is safe when the span result is not needed. Register
non-span promises with `startEvalBackgroundJob(promise)`. The runner only waits
for settlement; promise and span errors keep their normal behavior. Use
`waitForBackgroundJob: false` on a span, or `waitForBackgroundJobs: false` on an
eval definition, when background work should not delay finalization.

Eval Date APIs use a shifted wall clock by default: `new Date()` and
`Date.now()` start at `2026-04-10T00:00:00.000Z` during case generation,
execution, tracing, derived outputs, and scorers, then continue advancing with
real elapsed time. Set `startTime` on a specific `defineEval(...)` to use
another initial clock value, or set `startTime: 'now'` for that eval to use the
real current clock. Timers are not faked, so async waits still run normally.
Set `freezeTime: true` to keep Date APIs frozen until they are moved manually.
Use `evalTime.startTime` to read the captured wall-clock start as a Dayjs
object, and `evalTime.dayjs(...)` to create other Dayjs date objects. Use
`evalTime.advance(amount, unit)` inside an eval to move the shifted clock
forward with Dayjs `add(...)` units. It throws for evals with
`startTime: 'now'`, unless `freezeTime: true` is also set.

For libraries or observability exporters that already emit span lifecycle
events, use `evalTracer.startSpan(...)`, `evalTracer.updateSpan(...)`,
`evalTracer.endSpan(...)`, or `evalTracer.recordSpan(...)` to translate those
events into the eval trace tree without wrapping the upstream work in a
callback. Pass the upstream span id and parent id when available so the UI keeps
the original hierarchy. The Trace tab can switch between that recorded hierarchy
and UI-only timeline nesting for flat exported traces; saved trace JSON and
`deriveFromTracing` continue to use the recorded parent ids.

### Eval file (thin)

```ts
// evals/refund-workflow.eval.ts
import { defineEval, z } from '@ls-stack/agent-eval';
import { runRefundWorkflow } from '../src/workflows/refundWorkflow.ts';

const outputsSchema = z.object({
  response: z.string(),
  costUsd: z.number().optional(),
  toolCalls: z.number(),
  llmTurns: z.number(),
});
type RefundOutputs = z.infer<typeof outputsSchema>;

defineEval<RefundInput, RefundOutputs>({
  id: 'refund-workflow',
  cases: [
    { id: 'simple-text', input: { message: 'I want a refund for order #123' } },
  ],
  outputsSchema,
  execute: async ({ input }) => {
    await runRefundWorkflow(input);
  },
  deriveFromTracing: ({ trace }) => ({
    toolCalls: trace.findSpansByKind('tool').length,
  }),
  scores: {
    mentionsRefund: {
      passThreshold: 1,
      compute: ({ outputs }) => (/refund/i.test(outputs.response) ? 1 : 0),
    },
  },
});
```

`execute` usually just calls the product code. Push any placeholder
`evalTracer.span(...)` wrappers out of the eval and into the product module
they describe so production runs get the same trajectory. Only keep tracing
inside `execute` when the behavior being measured is eval-specific (e.g. a
judge-only sub-step with no production analogue).

Case `id` values anchor historical runs, caches, and manual scores — keep them
stable. See `EvalDefinition` / `EvalCase` in the types for every supported
field.

### Manual input

Use `manualInput` instead of `cases` when each run should pause for the user
to type values:

```ts
const inputSchema = z.object({
  name: z.string().min(1),
  tone: z.enum(['friendly', 'formal']),
  notes: z.string().max(500).optional(),
  sendEmail: z.boolean().default(false),
});

defineEval<z.infer<typeof inputSchema>>({
  id: 'manual-input-greeting',
  manualInput: {
    schema: inputSchema,
    title: 'Greet someone',
    submitLabel: 'Greet',
    fields: { notes: { multiline: true, rows: 4 } },
  },
  execute: ({ input, setOutput }) => {
    setOutput('greeting', `Hi, ${input.name}!`);
  },
});
```

The web UI opens a modal driven by the descriptor derived from the schema
(`z.string` → text, `z.enum` → select, `z.boolean` → checkbox, etc.; nested
shapes fall back to a JSON textarea). The CLI accepts `--input '<json>'` for a
single targeted eval or `--input-file <path>` mapping eval keys/ids to inputs.
Each run produces one synthetic case `<evalId>-manual` with the validated
submission; mixing `manualInput` with `cases` is rejected at discovery time.

For file or image fields, set `{ asFile: true, accept?, maxSizeBytes? }` and
type the field with `manualInputFileValueSchema`. The widget supports click,
drag-and-drop, and clipboard paste (so a screenshot capture flows in
directly). The runtime value carries `{ name, mimeType, sizeBytes, sha256,
path }`, where `path` is a workspace-relative run artifact. Use
`readManualInputFile(value)` when bytes, `Blob`, `File`, text, or parsed JSON
are needed. In CLI runs, provide path objects such as
`{ "image": { "path": "./screenshot.png" } }`; the CLI stages the file before
starting the run.

## Scoring

Every score returns a normalized `0..1` value. Pass/fail is per-score: a case
fails if any score with `passThreshold` falls below it, if an assertion fails,
or if the case errors. Scores without `passThreshold` are informational.

Score functions run in their own trace scope, separate from the execution
trace, so LLM-as-judge scorers can use `evalTracer.span(...)` and cached spans
without polluting the agent trajectory. Outputs set inside a scorer stay
private to that score.

`manualScores` declares score columns that reviewers fill in after a run.
Pending values keep the eval in an `unscored` state instead of failing.

See `EvalScoreDef` / `EvalManualScoreDef` in the types for the full shape
(format, threshold, column overrides).

## Outputs, columns, trace display

- `setEvalOutput(key, value)` writes reviewable data for the case. Values are
  stored as received: primitives, objects/arrays, explicit file refs, and
  native `Blob`/`File` values. `columns.format` only controls visualization.
  Non-JSON runtime values such as `Date`, `Map`, `Set`, `BigInt`, typed arrays,
  and class instances use the tagged value serializer instead of a string
  fallback. Native `Blob`/`File` values are copied to run artifacts because
  saved run files are JSON. Inside `execute`, prefer the context
  `setOutput(key, value)` helper when writing schema-backed outputs; it is
  typed from the eval's outputs generic. Keep `setEvalOutput` for shared
  workflow code that does not receive the execute context.
- Use `incrementEvalOutput(key, delta)` for numeric totals,
  `appendToEvalOutput(key, value)` for arrays that preserve existing scalar
  values, and `mergeEvalOutput(key, patch)` for shallow object updates.
  `evalSpan` has matching `incrementAttribute`, `appendToAttribute`, and
  `mergeAttribute` helpers for span attributes.
- `outputsSchema` validates final outputs after `execute` and
  `deriveFromTracing`, before computed scores. For Zod object schemas, only
  declared keys are passed to the schema; parsed fields merge back into the raw
  output map, so defaults/transforms apply to configured fields and
  unconfigured outputs stay visible as before. Validation failures fail the case
  and skip computed scores. When you pass a narrowed outputs type as the second
  `defineEval` generic, `outputsSchema` is required.
- `columns` overrides the display for output and score keys (label, format,
  alignment, visibility). The set of supported formats is declared by the
  `ColumnFormat` union and `EvalColumnOverride` in the types. Global
  `columns` in `agent-evals.config.ts` apply to every eval; eval-level
  `columns` override matching global keys. Use `hideIfNoValue: true` to hide a
  column from the runs table when every rendered row is missing the value,
  `null`, or an empty string; `0` and `false` still count as values, and the
  value remains available in case details and raw output data.
  In the case detail Output tab, string outputs that look like Markdown render
  as Markdown even without `format: 'markdown'`, with a Preview/Raw toggle for
  inspecting the original text.
- `deriveFromTracing` can be authored globally in `agent-evals.config.ts` or
  locally on one eval. Prefer the keyed map form for shared metrics:
  `deriveFromTracing: { toolCalls: ({ trace }) => trace.findSpansByKind('tool').length }`.
  The older object-returning function form remains supported. Global
  derivations run first; runtime outputs are never overwritten, and eval-level
  derivations only fill keys still missing after global derivations. In keyed
  form, return `undefined` to omit one output for that case.
- `traceDisplay` promotes selected span attributes into the trace tree and
  detail pane; it supports aggregation across subtrees (`scope`, `mode`) and
  user-defined `transform(...)` for derived views (e.g. currency conversion).
  See the `TraceDisplayInputConfig` type.
- `llmCalls` (in `agent-evals.config.ts`) configures how LLM-call spans are
  summarized for review. Defaults to `kind: 'llm'` spans with `model`,
  `usage.*`, `latencyMs`, `input`, `output`, etc. read from conventional
  attribute paths. `latencyMs` is time to first token; duration, total tokens,
  tokens/sec, and USD costs are derived. Override `kinds` to broaden the filter,
  override `attributes.<field>` for non-default primitive span shapes, configure
  model-keyed `pricing` to derive USD costs from token counts, with nested
  `providers` entries for provider-specific rates, add `costCurrencies` to show
  converted cost columns in the expanded breakdown table only, add
  `derivedAttributes` to persist computed values back onto matching LLM spans
  before trace consumers run, and add entries to `metrics` to surface arbitrary user metrics
  (`format: 'string' | 'number' | 'duration' | 'json' | 'boolean'`,
  `placements: ['header' | 'body']`). `derivedAttributes` can be a keyed map
  for one-off fields or one callback that returns multiple path/value pairs.
  Derived keys are dot-paths under `span.attributes`; return `undefined` to
  skip one span or one returned key. For saved runs,
  the case drawer more menu can recalculate configured LLM/API derived
  attributes for one case and persist the updated trace artifacts without
  re-running the eval.
- Default usage config derives missing eval outputs from matching LLM/API spans
  before `outputsSchema` and scores run: `apiCalls`, `costUsd`, `llmTurns`,
  `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`,
  `cacheCreationInputTokens`, `reasoningTokens`, and `llmDurationMs`. Authored
  outputs and column overrides win. Default usage columns, stats, and charts
  use `hideIfNoValue: true`, so the UI hides them until matching LLM/API span
  data exists. Default LLM usage charts render cost, input tokens, and output
  tokens separately and use `dedupeConsecutiveValues: true` to skip repeated
  adjacent chart values. `totalTokens` is input + output only; cache read/write
  tokens stay separate and affect `costUsd` at their own rates.
  Derived base input cost uses `inputTokens - cachedInputTokens -
cacheCreationInputTokens` so cache details are not double-counted.
  `cacheCreationInputTokens` is the total cache-write count; optional
  `cacheCreationInput1hTokens` only splits that total for 1-hour write pricing
  via `cacheCreationInput1hUsdPerMillion`. `llmDurationMs` sums elapsed matched
  LLM span durations; it is not time-to-first-token latency.
  Remove defaults globally or per eval with `removeDefaultConfig: true` or a
  key list such as
  `removeDefaultConfig: ['apiCalls', 'reasoningTokens']`.
- `apiCalls` (in `agent-evals.config.ts`) configures how API-call spans are
  summarized for review. Defaults to `kind: 'api'`, `'http'`, `'http.client'`,
  and `'fetch'` spans with `method`, `url`, `statusCode`, `request`,
  `response`, `requestBody`, `responseBody`, `headers`, `durationMs`, and
  `error` read from conventional attribute paths. Override `kinds` or
  `attributes.<field>` for external tracers, add `derivedAttributes` as a
  keyed map or object-returning callback for computed persisted API span
  attributes, and add `metrics` with the same formats and placements as
  LLM-call metrics.
- `runLogs` (in `agent-evals.config.ts`) controls case log capture. Use
  `runLogs: { captureConsole: false }` to keep console output in the terminal
  without persisting console calls to case details. Manual `evalLog(...)` calls
  are still captured.

Stats rows and history charts on the eval card can be authored via `stats` /
`charts` on the eval definition. Global `stats` in `agent-evals.config.ts`
render before eval-level stats. Usage stats and LLM usage charts are added by
default unless removed with `removeDefaultConfig`. Column stats can override
`format` and `numberFormat`, otherwise they inherit from the matching column.
Number formats use `maxDecimalPlaces` to cap decimals and `minDecimalPlaces`
to pad trailing zeroes. Without `maxDecimalPlaces`, they render up to 3 decimal
places. Stats and charts support `hideIfNoValue: true`; stats hide when they
would otherwise render an empty value, and charts hide when no plotted metric or
tooltip extra has a numeric value in the rendered history window. Charts support
`dedupeConsecutiveValues: true` to omit consecutive points whose plotted metrics
and tooltip extras match the previous kept point.
Their shapes live in the types; no need to memorize the option set.

## Cached operations

Wrap a costly pure span in `cache: { namespace, key }` so later runs replay its
recorded effects without re-executing:

```ts
await evalTracer.span(
  {
    kind: 'llm',
    name: 'plan-refund',
    cache: {
      namespace: 'refund-workflow__plan-refund',
      key: { prompt: input.message, model: 'gpt-4o-mini' },
    },
  },
  async () => {
    const result = await llm.complete(input.message);
    evalSpan.setAttributes({
      model: 'gpt-4o-mini',
      provider: 'openai',
      usage: result.usage,
      output: result,
    });
    return result;
  },
);
```

Use `evalTracer.cache(...)` for pure values that should not create their own
trace span:

```ts
const context = await evalTracer.cache(
  { name: 'receipt-audit-context', key: { orderId: input.orderId } },
  async () => {
    const result = await loadReceiptContext(input);
    evalSpan.setAttribute('receiptContext', result);
    evalSpan.mergeAttribute('receiptSummary', { orderId: input.orderId });
    return result;
  },
);
```

Mental model:

- Only SDK-mediated effects replay on a hit: sub-spans, checkpoints,
  output helper calls, span attributes. External side
  effects (HTTP, DB writes, file I/O) **do not** replay — cache only pure
  functions of the key.
- `evalTracer.cache(...)` does not create a span. When it runs inside an active
  span, that span gets a `cache.refs` entry with the value cache name, key,
  namespace, and hit/miss status. When called directly from the case body
  (no surrounding span), the ref is recorded on the case detail's `cacheRefs`
  array.
- Cache identity is the namespace plus the authored key. Source-file
  fingerprints are tracked for run freshness separately, but do not participate
  in cache-key hashing.
- Cached spans require an explicit `cache.namespace`; value caches default to
  `${evalId}__${name}` and can be overridden with `namespace`. Matching
  namespaces share entries across operations/evals that use the same authored
  key.
- Per eval, `cache: { read?: boolean; store?: boolean }` controls whether
  authored cached operations may read or persist entries. Both default to
  `true`. Use `read: false` to always execute instead of replaying hits, and
  `store: false` to allow reads while preventing misses/refreshes from writing
  cache or raw-key debug files. Run-level bypass/refresh controls still take
  precedence.
- Authored eval ids are unique within one eval file. The exact eval identity is
  the workspace-relative file path plus eval id, so the same id can be reused in
  different files. Case ids must be unique within one eval; duplicate case ids
  are reported as run errors.
- Cache keys should be deterministic primitives, arrays, and plain objects.
  `Buffer`, `ArrayBuffer`, and typed arrays hash by bytes. Native `Blob`/`File`
  keys use stable metadata by default (`type`, `size`, plus
  `name`/`lastModified` for `File`) and do not read file bytes. Add
  `serializeFileBytes: true` to a cached span or `evalTracer.cache(...)` call
  when byte-level cache invalidation is required.
- Cache entries are stored in inspectable owner files under
  `.agent-evals/cache/<owner>.json`; each namespace is capped at 100 entries by
  default. Configure `cache.maxEntriesPerNamespace` for the default cap and
  `cache.maxEntriesByNamespace` for exact namespace-specific caps.
- Nested cached JSON values at or above roughly 10K JSON characters are stored
  as content-addressed Brotli blobs under `.agent-evals/cache-blobs/` and
  referenced from cache JSON by sha256. Identical large payloads share the same
  blob.
- Authored raw cache keys are stored for debugging under
  `.agent-evals/cache-debug/<owner>.json`. This folder may include prompts,
  user inputs, or other sensitive data, should be gitignored, and is not needed
  for cache reuse. The UI Cache tab shows the raw key when it is available and
  can be filtered to hits or new entries added by cache misses/refreshes.
  Misses/refreshes with `cache.store: false` are shown as non-stored activity
  without fetch/delete controls.
- Cached payloads use JSON-safe tagged serialization, so return values and
  recorded SDK effects preserve richer built-ins such as `Date`, `Map`, `Set`,
  typed arrays, `URL`, `Headers`, `Blob`, and `File` on hits. Undefined values
  are omitted by default instead of being written to cache files; direct
  serializer callers can pass
  `{ preserveUndefined: true }` when explicit undefined wrappers are needed.
  Cache keys still use the deterministic key-hashing rules above.
- Cache mode per run is controlled by CLI flags (see `agent-evals run --help`).

## Artifacts

Run output lives under `.agent-evals/runs/<run-id>/` and cache entries under
`.agent-evals/cache/<eval-id>.json`. Files in a run directory include run
metadata, a run summary, per-case results, and per-case trace JSON. Inspect
these when debugging persisted output, costs, columns, traces, or failures.
Temporary runs use the same directory layout, but are removed before the next
run of any kind starts.

Use `agent-evals show-runs` when you need stable file
paths before reading saved output:

```sh
agent-evals show-runs
agent-evals show-runs latest --json
jq . .agent-evals/runs/<run-id>/summary.json
jq -s . .agent-evals/runs/<run-id>/cases.jsonl
jq . .agent-evals/runs/<run-id>/case-details/<case-id>.json
jq . .agent-evals/runs/<run-id>/traces/<case-id>.json
```

Run ids can be full timestamp ids, short ids such as `r0` from
`agent-evals show-runs`, or `latest`. `show-runs` is only an artifact index;
the files themselves remain the source of truth for detailed results and
traces.

## Module mocking

For true module replacement inside an eval, register `mock.module(...)` from
`node:test` before dynamically importing the module graph. Agent Evals enables
Node's `--experimental-test-module-mocks` flag automatically for CLI and app
runs. Use dynamic
`import(...)` inside `execute` — static imports happen too early.

```ts
import { mock } from 'node:test';
import { defineEval } from '@ls-stack/agent-eval';

defineEval({
  id: 'module-mock-demo',
  cases: [{ id: 'mocked-dependency', input: { customerId: 'vip-100' } }],
  execute: async ({ input, setOutput }) => {
    mock.module('../src/customerLookup.ts', {
      namedExports: { lookupCustomer: async () => ({ segment: 'vip' }) },
    });
    const { runWorkflow } = await import('../src/workflow.ts');
    const result = await runWorkflow(input);
    setOutput('segment', result.segment);
  },
});
```

## Workflow checklist

When adding or changing evals:

1. Put the tracing + ambient SDK calls in the product code that runs in both
   production and evals. Keep eval files thin.
2. Use realistic cases drawn from real product flows; avoid placeholder inputs.
3. `evalAssert` for hard invariants and truthy type narrowing, `evalExpect`
   for non-trivial comparisons, `scores` for graded signals, `passThreshold`
   only on scores that should gate pass/fail.
4. Surface reviewable values through execute-context `setOutput` or ambient
   `setEvalOutput` in shared workflow code, and shape them with `columns`
   formats from the `ColumnFormat` type.
5. Promote high-signal span attributes with `traceDisplay` so they surface in
   the trace tree and detail pane.
6. Cache costly pure spans with `cache: { namespace, key }` and pure spanless
   values with `evalTracer.cache(...)`; never cache operations whose external
   side effects you depend on.
7. Sanity-check after changes: `agent-evals list`, then
   `agent-evals run --eval <id>`; use `--file <path|glob>` to target one file
   when multiple files use the same eval id.
8. Locate saved artifacts with `agent-evals show-runs latest --json`, then read
   the relevant `summary.json`, `cases.jsonl`, `case-details/<case-id>.json`,
   or `traces/<case-id>.json` file directly.
