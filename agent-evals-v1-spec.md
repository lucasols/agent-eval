# Agent Evals UI-First Runner — V1 Spec

## 1. Product definition

Build a **local-first, UI-first eval tool for LLM/agent systems** where:

- evals are authored in **strict TypeScript** inside `*.eval.ts` files
- eval execution uses **Vitest** under the hood so normal `expect()` and `vi.mock()` work
- runs are **manual only** by default from the UI and also runnable from the CLI
- the UI is intentionally **minimal** in v1
- the tool highlights **trajectory**, **cost**, **inputs/outputs**, and **cache usage**
- caching is **inspectable, file-based, and commit-friendly**
- traces are visible in the UI in a simple but useful tree/detail format

This version should focus on the **core workflow for robust agent testing**, not analytics or collaboration.

---

## 2. Hard requirements

### 2.1 Must-have product behavior

1. Eval files are `*.eval.ts`.
2. Tests/runs do **not** automatically execute on file change.
3. Runs are triggered manually from:
   - the UI
   - the CLI
4. Module mocking must work using native Vitest APIs:
   - `vi.mock()`
   - `vi.spyOn()`
   - standard `expect()` assertions
5. The UI must show:
   - eval list
   - run controls
   - run summary
   - per-case result rows
   - case detail drawer
   - trace tree/detail
   - cost
   - inputs and outputs, including multimodal content
6. Cache behavior must be controllable from the UI at run time.
7. Cache storage must be file-based and easy to inspect, diff, commit, and review.
8. The results table must support custom columns.
9. The tool must be local-first and single-user in v1.

### 2.2 Must-have technical constraints

Use these choices unless implementation becomes impossible:

- **React**
- **strict TypeScript**
- **React Compiler**
- **React Compiler-friendly libraries only**
- **Vindur** for styling
- **Vite PWA**
- **t-state** for global state
- **@ls-stack/utils** for general utilities
- **ESLint**
- **Hono** for server/API
- **Hono RPC** for typed request/response APIs
- **Hono SSE** for live run updates in v1
- **Vitest** as the underlying test runner

Do **not** add heavy UI or data libraries unless clearly necessary.

---

## 3. Non-goals for v1

Do **not** implement these in v1:

- multi-user auth
- cloud sync
- remote database
- dashboards/trends/history analytics
- dataset editing in the UI
- run-to-run diff UI
- collaboration/comments
- plugin marketplace
- advanced artifact management
- WebSocket transport (SSE is enough for v1)
- provider-specific integrations beyond a minimal generic API
- auto-rerun/watch execution

---

## 4. High-level architecture

Use a **pnpm workspace monorepo**.

```txt
apps/
  web/                    # React/Vite/PWA client
  server/                 # Hono server (RPC + SSE + static file serving)
packages/
  shared/                 # zod schemas, shared types, RPC contracts
  sdk/                    # eval authoring API used inside *.eval.ts
  runner/                 # Vitest-backed long-lived runner
  cli/                    # manual CLI commands powered by the same runner
examples/
  basic-agent/            # one example project / example eval

.agent-evals/             # generated local runtime state (gitignored)
evals/
  recordings/             # committable recorded cache (NOT gitignored)
  datasets/               # example datasets
```

### 4.1 Local-first storage strategy

Use file-based storage only in v1.

- Generated/runtime-only state goes into `.agent-evals/`.
- Committable cache/recordings go into `evals/recordings/`.
- No SQLite in v1.

### 4.2 Process model

Use two app processes in dev:

- `apps/web`: Vite dev server
- `apps/server`: Hono server + long-lived runner

In production:

- build the web app
- Hono serves the static client and API

---

## 5. Core user workflows

### 5.1 Open app and inspect evals

User can:

- see discovered eval files/suites
- see whether a suite is stale
- select one or more suites

### 5.2 Manually run evals

User can:

- run all suites
- run selected suites
- cancel the current run
- choose cache mode
- choose trial count

### 5.3 Inspect results quickly

User can:

- sort by cost, score, latency, status
- open a case drawer
- inspect inputs/outputs
- inspect trace tree
- inspect scorer results
- inspect error/failure reasons

### 5.4 Use evals from CLI

User can:

- run all evals
- run specific files
- run specific cases if possible
- choose cache mode and trials
- get a proper exit code

---

## 6. V1 UX scope

V1 is a **single-page operator console**.

### 6.1 Layout

#### Left sidebar

Shows:

- eval suites/files
- stale indicator
- last known status badge

#### Top action bar

Contains:

- Run selected
- Run all
- Cancel
- Cache mode select
- Trial count input/select
- Refresh discovery

#### Sticky run summary bar

Always visible while a run exists.

Must show:

- run status
- total pass / fail counts
- average score
- total duration
- **total billed cost**
- **total uncached equivalent cost**
- **cache savings**

Cost must be visually prominent.

#### Main results table

Built-in columns:

- case id
- status
- score
- latency
- cost
- cache

Plus custom columns.

Requirements:

- sortable built-in columns
- sortable custom scalar columns
- column show/hide menu
- sticky `status` and `cost` columns if practical
- clicking a row opens the case detail drawer

#### Case detail drawer / panel

Tabs or sections:

1. Inputs
2. Output
3. Scores
4. Trace
5. Raw
6. Error (only when relevant)

Keep the UI minimal and native-looking.

### 6.2 Things to intentionally skip in the UI

Do not build in v1:

- charts
- historical analytics
- diff viewers
- editable trace graphs
- advanced filters
- dashboard home screen

---

## 7. Eval authoring API

The API should be optimized for:

- strict typing
- normal Vitest usage
- better support for trajectory assertions
- easy mapping to UI outputs
- multimodal input/output display
- custom columns

### 7.1 Main exported API

`packages/sdk` must export:

- `defineEval`
- `blocks`
- `repoFile`
- `createScorer`
- `installEvalMatchers`
- `createPriceRegistry`
- `estimateCost`
- `traceHelpers`
- `cacheHelpers`

### 7.2 Suggested main API shape

```ts
export type ScalarCell = string | number | boolean | null

export type ColumnDef = {
  key: string
  label: string
  kind: 'string' | 'number' | 'boolean'
  defaultVisible?: boolean
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
}

export type RepoFileRef = {
  source: 'repo'
  path: string
  mimeType?: string
}

export type RunArtifactRef = {
  source: 'run'
  artifactId: string
  mimeType: string
  fileName?: string
}

export type FileRef = RepoFileRef | RunArtifactRef

export type DisplayBlock =
  | { kind: 'text'; label?: string; text: string }
  | { kind: 'markdown'; label?: string; text: string }
  | { kind: 'json'; label?: string; value: unknown }
  | { kind: 'image'; label?: string; ref: FileRef; alt?: string }
  | { kind: 'audio'; label?: string; ref: FileRef; title?: string }
  | { kind: 'video'; label?: string; ref: FileRef; title?: string }
  | { kind: 'file'; label?: string; ref: FileRef; title?: string }

export type EvalCase<TInput> = {
  id: string
  input: TInput
  displayInput: DisplayBlock[]
  columns?: Record<string, ScalarCell>
  tags?: string[]
}

export type EvalTaskResult<TOutput> = {
  output: TOutput
  displayOutput?: DisplayBlock[]
  columns?: Record<string, ScalarCell>
  meta?: Record<string, ScalarCell>
}

export type ScoreResult = {
  id: string
  label?: string
  score: number
  pass?: boolean
  reason?: string
  display?: DisplayBlock[]
  columns?: Record<string, ScalarCell>
}

export type EvalTaskContext<TInput> = {
  case: EvalCase<TInput>
  input: TInput
  signal: AbortSignal
  trace: EvalTraceRecorder
  runtime: EvalRuntimeContext
}

export type EvalAssertContext<TInput, TOutput> = {
  case: EvalCase<TInput>
  input: TInput
  output: TOutput
  trace: EvalTraceTree
  scores: ScoreResult[]
  cost: EvalCostSummary
  columns: Record<string, ScalarCell>
}

export type EvalDefinition<TInput, TOutput> = {
  id: string
  title?: string
  description?: string
  data: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>)
  columnDefs?: ColumnDef[]
  task: (ctx: EvalTaskContext<TInput>) => Promise<EvalTaskResult<TOutput>>
  scorers?: Array<(ctx: {
    case: EvalCase<TInput>
    input: TInput
    output: TOutput
    trace: EvalTraceTree
    runtime: EvalRuntimeContext
  }) => Promise<ScoreResult> | ScoreResult>
  assert?: (ctx: EvalAssertContext<TInput, TOutput>) => void | Promise<void>
  passThreshold?: number | null
}
```

### 7.3 `defineEval()` behavior

`defineEval()` should:

1. register eval metadata for the runner/UI
2. create the Vitest suite/tests internally
3. create one Vitest test per case
4. preserve normal Vitest semantics so `expect()` and `vi.mock()` work naturally

### 7.4 Example eval file

```ts
import { defineEval, blocks, repoFile, installEvalMatchers } from '@agent-evals/sdk'
import { expect, vi } from 'vitest'

installEvalMatchers()

vi.mock('../src/analytics', () => ({
  track: vi.fn(),
}))

defineEval({
  id: 'refund-agent',
  title: 'Refund agent',
  data: async () => [
    {
      id: 'simple-text',
      input: {
        message: 'I want a refund for order #123',
        locale: 'en-US',
      },
      displayInput: [
        blocks.markdown('I want a refund for order #123'),
      ],
      columns: {
        locale: 'en-US',
        priority: 'normal',
      },
    },
    {
      id: 'with-image-and-audio',
      input: {
        message: 'Please refund this damaged item',
        receiptImage: 'evals/datasets/assets/receipt-1.png',
        voiceNote: 'evals/datasets/assets/note-1.mp3',
      },
      displayInput: [
        blocks.markdown('Please refund this damaged item'),
        blocks.image(repoFile('evals/datasets/assets/receipt-1.png', 'image/png')),
        blocks.audio(repoFile('evals/datasets/assets/note-1.mp3', 'audio/mpeg')),
      ],
      columns: {
        locale: 'en-US',
        priority: 'high',
      },
    },
  ],
  columnDefs: [
    { key: 'locale', label: 'Locale', kind: 'string', defaultVisible: true },
    { key: 'priority', label: 'Priority', kind: 'string', defaultVisible: true },
    { key: 'toolCalls', label: 'Tool Calls', kind: 'number', defaultVisible: true },
  ],
  task: async ({ input, trace, signal }) => {
    const result = await trace.span({ kind: 'agent', name: 'refund-agent' }, async (span) => {
      // agent execution goes here
      // span.recordInput(...)
      // span.recordOutput(...)
      // span.recordUsage(...)
      return {
        finalText: `Approved refund for: ${input.message}`,
        toolCalls: 2,
      }
    })

    return {
      output: result.finalText,
      displayOutput: [blocks.markdown(result.finalText)],
      columns: {
        toolCalls: result.toolCalls,
      },
    }
  },
  scorers: [
    async ({ output }) => ({
      id: 'mentions-refund',
      score: /refund/i.test(output) ? 1 : 0,
      reason: 'Checks whether output mentions refund.',
    }),
  ],
  assert: ({ output, trace, cost }) => {
    expect(output).toMatch(/refund/i)
    expect(trace).toCallSpan('refund-agent')
    expect(trace).toUseAtMostTurns(6)
    expect(cost.totalUsd ?? 0).toBeLessThan(0.10)
  },
})
```

---

## 8. Better trajectory/mid-task assertion support

The SDK should preserve raw Vitest behavior but add **trace-aware matchers**.

### 8.1 Design principle

Do **not** replace `expect()`.

Instead:

- keep normal Vitest `expect()`
- add custom matchers via `expect.extend()` through `installEvalMatchers()`
- allow users to assert either after the run or during task execution if they want to use plain `expect()` manually

### 8.2 Required custom matchers for v1

Implement these matchers on the trace tree:

- `toCallSpan(name)`
- `toCallTool(name)`
- `toContainSequence(sequence)`
- `toHaveMaxDepth(maxDepth)`
- `toUseAtMostTurns(maxTurns)`
- `toCostLessThan(maxUsd)`
- `toStayUnderLatency(maxMs)`
- `toHaveNoErrorSpans()`

Optional if easy:

- `toMatchSpan(predicate)`
- `toContainTextInAnyOutput(text)`

### 8.3 Sequence matcher input format

Use a simple format:

```ts
expect(trace).toContainSequence([
  { kind: 'tool', name: 'searchDocs' },
  { kind: 'tool', name: 'getRefundPolicy' },
  { kind: 'llm' },
])
```

The sequence matcher should work over a flattened depth-first event list.

### 8.4 Mid-task assertions

V1 should support mid-task assertions in two ways:

1. **Plain `expect()` anywhere in the task body**
2. **Trace checkpoints** for later inspection/assertion

Add a helper:

```ts
trace.checkpoint('planner-state', {
  selectedIntent: 'refund',
  confidence: 0.91,
})
```

Checkpoint spans appear in the trace UI as `kind: 'checkpoint'`.

---

## 9. Mapping API fields to UI output

This mapping is mandatory.

| API field | UI location | Notes |
|---|---|---|
| `EvalCase.id` | results table `case id` column | always visible |
| `EvalCase.displayInput` | case detail `Inputs` tab | render multimodal blocks |
| `EvalCase.columns` | results table custom columns | merged with task/scorer columns |
| `EvalTaskResult.displayOutput` | case detail `Output` tab | preferred output display |
| `EvalTaskResult.columns` | results table custom columns | merged into row |
| `ScoreResult.score` | Scores tab + aggregate score column | aggregate score = mean of scorer scores |
| `ScoreResult.reason` | Scores tab | show inline per scorer |
| `ScoreResult.display` | Scores tab | render rich scorer output if present |
| `trace` spans | Trace tab | tree + selected span detail |
| trace `usage/cost` | Trace tab + row/run summaries | sum upward to case and run |
| cache metadata | results table + Trace tab + summary | show hit/miss and savings |
| `passThreshold` | case status / run summary / CLI exit code | if set, fail case when aggregate score is below threshold |

### 9.1 Column merge rules

Final row columns are built in this order:

1. built-in system columns
2. `EvalCase.columns`
3. `EvalTaskResult.columns`
4. merged columns from scorer results

If the same key appears multiple times, later values override earlier ones.

### 9.2 Built-in system columns

Always available:

- `caseId`
- `status`
- `score`
- `latencyMs`
- `costUsd`
- `cacheStatus`

### 9.3 Custom column restrictions

V1 custom table columns must be scalar only:

- `string`
- `number`
- `boolean`
- `null`

Rich content belongs in the detail drawer, not inside table cells.

---

## 10. Multimodal inputs and outputs

### 10.1 Supported display block kinds in v1

- text
- markdown
- json
- image
- audio
- video
- file

### 10.2 Rendering rules

#### Inputs tab

Render `displayInput` in order.

#### Output tab

Render `displayOutput` in order.

If `displayOutput` is empty:

- show a JSON fallback from `output`

#### Raw tab

Always show:

- raw case input JSON
- raw task output JSON
- raw score JSON
- raw trace JSON

### 10.3 File references

Use this helper shape:

```ts
repoFile(path: string, mimeType?: string): RepoFileRef
```

The server must expose read-only endpoints that can resolve repo files safely.

Requirements:

- only serve files inside the workspace root
- reject path traversal
- set correct content type

### 10.4 Example block helpers

```ts
blocks.text(text: string)
blocks.markdown(text: string)
blocks.json(value: unknown)
blocks.image(ref: FileRef, alt?: string)
blocks.audio(ref: FileRef, title?: string)
blocks.video(ref: FileRef, title?: string)
blocks.file(ref: FileRef, title?: string)
```

---

## 11. Trace model

The trace model is a tree of spans.

### 11.1 Required span fields

```ts
export type TraceSpanKind =
  | 'eval'
  | 'agent'
  | 'llm'
  | 'tool'
  | 'retrieval'
  | 'scorer'
  | 'checkpoint'
  | 'custom'

export type EvalTraceSpan = {
  id: string
  parentId: string | null
  caseId: string
  kind: TraceSpanKind
  name: string
  startedAt: string
  endedAt: string | null
  status: 'running' | 'ok' | 'error' | 'cancelled'
  input?: unknown
  output?: unknown
  display?: DisplayBlock[]
  attributes?: Record<string, unknown>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  costUsd?: number | null
  cache?: {
    status: 'hit' | 'miss' | 'write' | 'bypass'
    key?: string
  }
  error?: {
    name?: string
    message: string
    stack?: string
  }
}
```

### 11.2 Trace recorder API

Provide a simple recorder API:

```ts
type EvalTraceRecorder = {
  span<T>(
    info: { kind: TraceSpanKind; name: string; attributes?: Record<string, unknown> },
    fn: (span: EvalTraceActiveSpan) => Promise<T>
  ): Promise<T>
  checkpoint(name: string, data: unknown): void
}

type EvalTraceActiveSpan = {
  setInput(value: unknown): void
  setOutput(value: unknown): void
  setDisplay(blocks: DisplayBlock[]): void
  setAttributes(value: Record<string, unknown>): void
  setUsage(value: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): void
  setCostUsd(value: number | null): void
  setCache(value: { status: 'hit' | 'miss' | 'write' | 'bypass'; key?: string }): void
  addArtifact(params: { filePath: string; mimeType: string; fileName?: string }): RunArtifactRef
}
```

### 11.3 Minimal trace UI for v1

The trace UI should be simple:

- collapsible tree list on the left
- selected span detail on the right
- badges for kind/status/cache
- show duration, tokens, cost
- show input/output JSON or display blocks

Do **not** build a flamegraph or advanced timeline in v1.

---

## 12. Cost model

Cost must be treated as a first-class value.

### 12.1 Required cost levels

Track cost at:

- span level
- case level
- run level

### 12.2 Required run summary values

For every run compute:

- `totalBilledCostUsd`
- `totalUncachedCostUsd`
- `totalSavingsUsd`

Rules:

- `totalBilledCostUsd` = sum of actual executed non-cached work
- `totalUncachedCostUsd` = estimated full cost without cache
- `totalSavingsUsd` = `totalUncachedCostUsd - totalBilledCostUsd`

### 12.3 Required case row values

Each case row must show:

- `costUsd`
- `uncachedCostUsd` (detail view is enough)
- `cacheStatus`

### 12.4 Cost capture strategy for v1

V1 does not need deep provider integrations.

Instead, support two ways:

1. explicit cost written by the task/span API
2. cost estimated from a simple model pricing registry

Add a simple config-level pricing registry:

```ts
export type ModelPricing = {
  inputPerMillionUsd: number
  outputPerMillionUsd: number
}

export type PricingRegistry = Record<string, ModelPricing>
```

And helper:

```ts
estimateCost(modelId: string, usage: { inputTokens?: number; outputTokens?: number }, registry: PricingRegistry): number | null
```

If cost cannot be determined, show `null` and render `—` in the UI.

---

## 13. Cache model

The cache system must be:

- explicit
- inspectable
- file-based
- safe to commit/review for recorded entries

### 13.1 Cache folder

Use a single gitignored folder in v1:

- path: `.agent-evals/cache/<namespace>/<key>.json`
- organized by namespace (e.g. `llm`, `tool`)
- for speed during development; not committed

### 13.2 Disabling the cache

Caching is always on by default. The only knob is a CLI flag:

- `--no-cache` — bypass both reads and writes; every call executes live

There are no configurable cache modes and no separate recorded cache in v1.

### 13.3 Cache entry format

Each entry is one pretty JSON file.

Suggested shape:

```json
{
  "schemaVersion": 1,
  "namespace": "llm",
  "key": "sha256:...",
  "request": {},
  "response": {},
  "meta": {
    "createdAt": "2026-03-29T12:00:00.000Z",
    "usage": {
      "inputTokens": 100,
      "outputTokens": 25,
      "totalTokens": 125
    },
    "costUsd": 0.0042,
    "latencyMs": 840
  }
}
```

Requirements:

- stable key generation using canonical JSON + hash
- stable pretty-print formatting
- file name includes hash key
- easy to diff in Git

### 13.4 Generic cache helper API

Provide a simple runtime API:

```ts
runtime.cache.getOrSet<T>(params: {
  namespace: string
  keyParts: unknown
  metadata?: Record<string, unknown>
  producer: () => Promise<T>
}): Promise<{
  value: T
  status: 'hit' | 'miss'
  key: string
}>
```

### 13.5 What is enough for v1 UI

The UI only needs:

- cache mode selector before run
- cache hit/miss indicator on case rows
- cache status on trace spans
- savings in run summary

Do **not** build cache entry editing or promotion tools in v1.

---

## 14. Run storage format

### 14.1 Paths

Generated run data goes under:

```txt
.agent-evals/runs/<runId>/
```

### 14.2 Required files per run

```txt
.agent-evals/runs/<runId>/
  run.json
  cases.jsonl
  traces/
    <caseId>.json
  artifacts/
    <caseId>/...
  summary.json
```

### 14.3 File meanings

#### `run.json`
Run manifest:

- id
- status
- startedAt
- endedAt
- selected targets
- cache mode
- trials

#### `cases.jsonl`
Append-only case row snapshots during execution.

Used for:

- live progress recovery
- simple reload support

#### `traces/<caseId>.json`
Final trace tree or flat span list for the case.

#### `summary.json`
Final aggregated run summary.

### 14.4 Run id format

Use a readable timestamp + random suffix.

Example:

```txt
2026-03-29T12-40-15Z_ab12cd
```

---

## 15. Runner architecture

### 15.1 Core principle

Use a **single long-lived Vitest runner instance**.

Runs are triggered manually.

### 15.2 Runner behavior

The runner must:

1. initialize Vitest without auto-running tests
2. discover eval files
3. collect eval metadata
4. stay idle until a run is requested
5. stream live events during runs
6. support cancellation

### 15.3 Required Vitest integration behavior

- use Vitest Node APIs
- do not rely on terminal-only behavior
- preserve normal `vi.mock()` and `expect()` behavior
- use programmatic run control

### 15.4 Discovery strategy for v1

Keep discovery simple.

On startup and on manual refresh:

1. glob `*.eval.ts` files
2. collect tests/manifests
3. rebuild in-memory eval metadata

### 15.5 File watching strategy for v1

Use `chokidar`.

Behavior:

- changes to `*.eval.ts` files trigger discovery refresh
- changes to other workspace source files do **not** auto-run tests
- changed source files mark all suites as `stale`
- UI shows stale badges

### 15.6 Cancellation

Support cancelling the active run.

Requirements:

- UI cancel button calls server cancel endpoint
- runner cancels current Vitest run
- task code receives `AbortSignal`
- UI reflects cancelled state

### 15.7 Concurrency

Keep concurrency simple in v1.

- support a global numeric concurrency setting
- default to a safe low value
- expose it in config, not necessarily the UI in v1

---

## 16. Runner event model

The runner must normalize Vitest events into app-specific events for SSE.

### 16.1 Required SSE events

Use newline-separated SSE messages with `event:` names.

Required event types:

- `discovery.updated`
- `run.started`
- `run.summary`
- `case.started`
- `case.updated`
- `case.finished`
- `trace.span`
- `run.finished`
- `run.cancelled`
- `run.error`

### 16.2 Event payload shape

All events should have this outer shape:

```ts
type SseEnvelope<T> = {
  type: string
  runId?: string
  timestamp: string
  payload: T
}
```

### 16.3 Minimal client event handling

The web app should:

- subscribe when a run starts or when opening an existing active run
- update t-state stores incrementally
- survive reconnects by refetching run state if necessary

---

## 17. Server API

Use Hono with:

- Zod validation
- Hono RPC for normal request/response routes
- plain SSE endpoint for live run events

### 17.1 Routes

Implement these routes in v1.

#### Discovery / evals

- `GET /api/evals`
- `POST /api/evals/refresh`
- `GET /api/evals/:evalId`

#### Runs

- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/cancel`
- `GET /api/runs/:runId/cases/:caseId`
- `GET /api/runs/:runId/events` (SSE)

#### Assets / files

- `GET /api/repo-file`
- `GET /api/artifacts/:artifactId`

### 17.2 `POST /api/runs` request body

```ts
{
  target: {
    mode: 'all' | 'evalIds' | 'caseIds'
    evalIds?: string[]
    caseIds?: string[]
  }
  disableCache?: boolean
  trials: number
}
```

### 17.3 `GET /api/evals` response

Should include:

- eval id
- title
- file path
- stale status
- column defs
- case count if known
- last run status if available

### 17.4 `GET /api/runs/:runId` response

Should include:

- run manifest
- current summary
- latest case rows
- run status

### 17.5 `GET /api/runs/:runId/cases/:caseId` response

Should include:

- case row
- raw case input
- display input
- raw output
- display output
- scorer results
- trace
- error
- custom columns

---

## 18. Shared schemas and typing

All request/response types and storage formats must be defined in `packages/shared` using **Zod**.

### 18.1 Required shared schemas

Create schemas for:

- `DisplayBlock`
- `ColumnDef`
- `EvalSummary`
- `CaseRow`
- `CaseDetail`
- `RunManifest`
- `RunSummary`
- `TraceSpan`
- `SseEnvelope`
- API request/response bodies

### 18.2 Shared code rules

- shared package must contain zero React code
- shared package must be usable by server, runner, CLI, and UI
- prefer explicit schemas over loose interfaces

---

## 19. Web app technical design

### 19.1 Stack rules

Use:

- React
- strict TypeScript
- Vindur
- t-state
- Hono RPC client
- React Compiler-compatible code patterns

Do not add:

- React Query
- Redux
- component kit libraries
- heavy data-grid libraries

### 19.2 State model using `t-state`

Create stores for:

- discovery / eval list
- current run summary
- case rows for current run
- selected case id
- selected trace span id
- table column visibility
- UI preferences (local only)

### 19.3 React Compiler safety rules

Keep components simple and compiler-friendly:

- functional components only
- no class components
- prefer explicit props
- keep render functions pure
- avoid unnecessary abstraction layers
- avoid third-party React libraries unless needed
- enable compiler/lint diagnostics in the project

### 19.4 Minimal component list

Build these components only:

- `AppShell`
- `SidebarEvalList`
- `RunToolbar`
- `RunSummaryBar`
- `ResultsTable`
- `ColumnVisibilityMenu`
- `CaseDrawer`
- `DisplayBlockRenderer`
- `TraceTree`
- `SpanDetail`
- `StatusBadge`
- `CostBadge`

### 19.5 `DisplayBlockRenderer`

Must render:

- text / markdown
- syntax-highlighted JSON if easy, plain preformatted if not
- image preview
- audio player
- video player
- file download link

Use native elements wherever possible.

---

## 20. Results table spec

### 20.1 Table requirements

Implement a custom lightweight table in v1.

Required features:

- display built-in + custom columns
- sort ascending/descending
- row selection by click
- sticky header
- empty values render as `—`

### 20.2 Column ordering

Default order:

1. case id
2. status
3. score
4. latency
5. cost
6. cache
7. custom columns in declaration order

### 20.3 Column visibility

- built-in columns cannot be fully removed, except maybe latency/cache if desired
- custom columns can be toggled on/off
- persist visibility in local storage

### 20.4 Cost emphasis

Cost column must be highly visible.

Requirements:

- right-aligned numeric display
- formatted as USD
- sortable
- also show in run summary and trace detail

---

## 21. CLI spec

The CLI is a thin wrapper around the same runner core.

### 21.1 Commands

Implement these commands in v1:

- `agent-evals dev`
- `agent-evals list`
- `agent-evals run`

### 21.2 Command behavior

#### `agent-evals dev`

Starts:

- Hono server
- runner
- optionally prints local URLs

#### `agent-evals list`

Prints discovered evals.

#### `agent-evals run`

Supports options:

- `--eval <id>` repeated or comma-separated
- `--case <id>` repeated or comma-separated if feasible
- `--no-cache` to bypass the cache for this run
- `--trials <n>`
- `--json`

### 21.3 CLI output requirements

Human mode:

- minimal progress output
- summary at end
- clear pass/fail counts
- total cost

JSON mode:

- print final run summary JSON only

### 21.4 Exit code rules

Exit non-zero when:

- any case throws/unhandled fails
- any assertion fails
- any case is below `passThreshold` if configured

---

## 22. Config file

Create `agent-evals.config.ts` at project root.

### 22.1 Required config shape

```ts
export type AgentEvalsConfig = {
  workspaceRoot?: string
  include: string[]
  defaultTrials?: number
  pricing?: PricingRegistry
  concurrency?: number
}
```

Runner state and cache live at the hardcoded path `.agent-evals/` under
`workspaceRoot` — neither the state dir nor the cache dir is configurable.

### 22.2 Default values

Use sensible defaults:

- `include: ['**/*.eval.ts']`
- `defaultTrials: 1`
- `concurrency: 2`

---

## 23. Build/tooling rules

### 23.1 TypeScript

Use strict settings, including:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`

### 23.2 ESLint

Use ESLint with:

- TypeScript rules
- React hooks/compiler-related rules
- project-specific simplicity rules if desired

### 23.3 Styling

Use Vindur only.

Do not add another styling system.

### 23.4 PWA

Use Vite PWA conservatively:

- cache app shell/static assets
- do not cache API routes
- do not cache SSE endpoint
- do not cache artifact routes
- use prompt-style updates, not forced reloads

---

## 24. Security and safety requirements

### 24.1 File serving

When serving repo files:

- resolve paths relative to workspace root
- reject path traversal
- never expose arbitrary absolute file paths

### 24.2 Secret handling

V1 should avoid storing obvious secrets in run files when possible.

Minimum requirement:

- do not intentionally serialize environment variables
- provide a small redaction helper for user-defined fields if easy

### 24.3 Failure safety

A broken eval should not crash the whole server.

Requirements:

- isolate run failures to the run/case level
- surface errors clearly in UI/CLI
- keep the server alive after run failures

---

## 25. Implementation order

The code agent should implement in this order.

### Phase 1 — Workspace and base apps

1. create pnpm workspace
2. create `apps/web`, `apps/server`, `packages/shared`, `packages/sdk`, `packages/runner`, `packages/cli`
3. set up strict TypeScript across all packages
4. set up ESLint
5. set up Vite + React + Vindur + PWA
6. set up Hono server

### Phase 2 — Shared schemas and config

1. implement Zod schemas in `packages/shared`
2. implement `agent-evals.config.ts` loading
3. create API types and shared storage types

### Phase 3 — SDK authoring API

1. implement `defineEval`
2. implement `blocks`
3. implement `repoFile`
4. implement trace recorder types and helpers
5. implement `installEvalMatchers()` with the required matchers
6. implement simple scorer helpers

### Phase 4 — Runner core

1. create long-lived Vitest runner wrapper
2. implement discovery
3. implement metadata collection
4. implement run start/cancel
5. implement file-based run storage
6. implement SSE event emission

### Phase 5 — Minimal server API

1. implement `/api/evals`
2. implement `/api/evals/refresh`
3. implement `/api/runs`
4. implement `/api/runs/:runId`
5. implement `/api/runs/:runId/cancel`
6. implement `/api/runs/:runId/cases/:caseId`
7. implement `/api/runs/:runId/events`
8. implement file/artifact serving routes

### Phase 6 — Minimal web UI

1. build app shell
2. build sidebar list
3. build run toolbar
4. build run summary bar
5. build results table with custom columns
6. build case drawer
7. build display block renderer
8. build trace tree + span detail

### Phase 7 — Cache + cost

1. implement cache namespaces and file format
2. add cache mode support to run options
3. add cache status to traces/case rows
4. add cost aggregation at span/case/run levels
5. highlight cost in UI and CLI output

### Phase 8 — CLI

1. implement `dev`
2. implement `list`
3. implement `run`
4. implement JSON output and exit codes

### Phase 9 — Example and self-tests

1. add at least one example eval project
2. add one eval using `vi.mock()`
3. add one eval with image + audio inputs
4. add one eval using custom columns
5. add one eval using trace assertions
6. add one eval using recorded cache

---

## 26. Acceptance criteria

V1 is complete when all of the following are true.

### 26.1 Authoring/runtime

- `*.eval.ts` files run successfully through the system
- `vi.mock()` works in eval files
- normal `expect()` works in eval files
- custom trace matchers work
- no automatic test execution happens on file save

### 26.2 UI

- user can run all or selected evals manually
- user can cancel a run
- user can open case details
- inputs render for text, image, and audio at minimum
- results table supports custom columns
- cost is visible per run and per case
- trace tree is visible and usable

### 26.3 Cache

- cache entries are plain JSON files under `.agent-evals/cache/`
- `--no-cache` CLI flag disables reads and writes for a run

### 26.4 CLI

- CLI can run evals manually
- CLI returns correct non-zero exit codes on failures

### 26.5 Stability

- server stays alive after eval errors
- refreshing discovery works
- stale markers work after file changes

---

## 27. Suggested first example scenario

Create an example refund/support agent eval suite with:

- one text-only case
- one text + image case
- one text + audio case
- one mocked dependency using `vi.mock()`
- one scorer
- one trace assertion
- one custom column (`priority`)
- one cost value captured via explicit span cost or pricing registry

This example should be used to verify the full v1 loop.

---

## 28. Implementation guidance for the code agent

Keep implementation pragmatic and minimal.

Prefer:

- readable code
- clear file formats
- direct data flow
- simple UI
- small dependency surface

Avoid:

- speculative abstractions
- advanced plugin systems
- premature optimization
- unnecessary third-party libraries

When choosing between a simpler and more generic approach, prefer the simpler one for v1.
