/** Topics supported by {@link printHelp}, mirroring the CLI command surface. */
export type HelpTopic =
  | 'global'
  | 'app'
  | 'list'
  | 'run'
  | 'show-runs'
  | 'cache'
  | 'cache list'
  | 'cache clear';

/** Render the help block for a given CLI topic to stdout via `console.info`. */
export function printHelp(topic: HelpTopic = 'global'): void {
  if (topic === 'app') {
    console.info(`
agent-evals app - Start server with UI

Usage:
  agent-evals app [flags]

Flags:
  --port <n>                 Server port (default: 4100)
  --no-env                   Disable automatic .env loading
  --help, -h                 Show this help
  `);
    return;
  }

  if (topic === 'list') {
    console.info(`
agent-evals list - List discovered evals

Usage:
  agent-evals list [flags]

Flags:
  --no-env                   Disable automatic .env loading
  --help, -h                 Show this help
  `);
    return;
  }

  if (topic === 'run') {
    console.info(`
agent-evals run - Run evals

Usage:
  agent-evals run [flags]

Flags:
  --eval <id>                Run specific eval(s) (comma-separated)
  --file <path|glob>         Run eval files matching path/glob (comma-separated)
  --case <id>                Run case(s); combine with --file/--eval if ambiguous
  --trials <n>               Number of trials per case
  --inspect[=host:port]      Run with the Node.js inspector enabled
  --inspect-brk[=host:port]  Enable inspector and pause before startup
  --json                     Output run summary as JSON
  --cache <use|bypass|refresh>  Cache mode for this run (default: use)
  --no-cache                 Shortcut for --cache bypass
  --refresh-cache            Shortcut for --cache refresh
  --clear-cache              Clear the cache before starting the run
  --input <json>             Manual input value for a single targeted eval
                             that declares manualInput
  --input-file <path>        JSON object keyed by eval key (or eval id) with
                             manual input values for one or more targeted evals
  --no-env                   Disable automatic .env loading
  --help, -h                 Show this help
  `);
    return;
  }

  if (topic === 'show-runs') {
    console.info(`
agent-evals show-runs - Show saved run artifact file paths

Usage:
  agent-evals show-runs [<run-id>|latest] [--json]

Prints the run directory and stable artifact paths for run.json, summary.json,
cases.jsonl, case detail JSON, and trace JSON files. Run ids can be full
timestamp ids, short ids such as r0, or latest.

Flags:
  --json                     Output the file index as JSON
  --no-env                   Disable automatic .env loading
  --help, -h                 Show this help
  `);
    return;
  }

  if (topic === 'cache' || topic === 'cache list' || topic === 'cache clear') {
    console.info(`
agent-evals cache - Manage cached operation entries

Usage:
  agent-evals cache list [flags]
  agent-evals cache clear --eval <id>
  agent-evals cache clear --all

Flags:
  --eval <id>                Clear entries for specific eval(s) (comma-separated)
  --all                      Confirm clearing every cached entry
  --json                     Output cache listing as JSON
  --no-env                   Disable automatic .env loading
  --help, -h                 Show this help
  `);
    return;
  }

  console.info(`
agent-evals - LLM/Agent eval runner

Commands:
  app                        Start server with UI
  list                       List discovered evals
  run                        Run evals
  show-runs [id|latest]      Show saved run artifact file paths
  cache list                 List cached operation entries
  cache clear --eval <id>    Clear cache entries for one eval
  cache clear --all          Clear every cached entry
  help                       Show this help

Options:
  --eval <id>                Run specific eval(s) (comma-separated)
  --case <id>                Run specific case(s) (comma-separated)
  --trials <n>               Number of trials per case
  --inspect[=host:port]      Run with the Node.js inspector enabled
  --inspect-brk[=host:port]  Enable inspector and pause before startup
  --json                     Output results as JSON
  --port <n>                 Server port (default: 4100)
  --cache <use|bypass|refresh>  Cache mode for this run (default: use)
  --no-cache                 Shortcut for --cache bypass
  --refresh-cache            Shortcut for --cache refresh
  --clear-cache              Clear the cache before starting the run
  --no-env                   Disable automatic .env loading
  --help, -h                 Show help
  `);
}
