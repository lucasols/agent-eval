import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCaseChildMessage,
  type CaseChildContext,
  type CaseChildResult,
} from './caseChildProtocol.ts';
import { stripTerminalControlCodes } from './stackFormatting.ts';

const moduleMocksFlag = '--experimental-test-module-mocks';
const inspectFlagPrefix = '--inspect';
const inspectBrkFlagPrefix = '--inspect-brk';
const childOutputTailMaxLength = 12_000;
const outputHeadlineMaxLength = 240;

type CaseChildOutputTail = {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export async function executeCaseChild(
  context: CaseChildContext,
): Promise<CaseChildResult> {
  const child = spawn(
    process.execPath,
    [...getCaseChildExecArgv(), resolveCaseChildEntrypoint()],
    {
      cwd: context.workspaceRoot,
      env: process.env,
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const outputTail = createCaseChildOutputTail(child);

  return await new Promise<CaseChildResult>((resolvePromise, rejectPromise) => {
    let result: CaseChildResult | undefined;
    let childError: Error | undefined;
    let settled = false;

    function settleWithError(error: Error): void {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    }

    child.once('error', (error) => {
      childError = new Error(`Failed to start case child: ${error.message}`);
    });

    child.on('message', (message: unknown) => {
      if (!isCaseChildMessage(message)) return;
      if (message.type === 'error') {
        childError = new Error(message.message);
        return;
      }
      result = message.result;
    });

    child.once('close', (code, signal) => {
      if (childError !== undefined) {
        settleWithError(childError);
        return;
      }
      if (result !== undefined && code === 0 && signal === null) {
        if (settled) return;
        settled = true;
        resolvePromise(result);
        return;
      }

      const reason = formatChildExitReason(code, signal);
      settleWithError(
        new Error(formatUnexpectedCaseChildExit(reason, outputTail)),
      );
    });

    child.send({ type: 'start', context });
  });
}

function createCaseChildOutputTail(child: ChildProcess): CaseChildOutputTail {
  const tail: CaseChildOutputTail = {
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  };
  child.stdout?.on('data', (chunk: Buffer | string) => {
    process.stdout.write(chunk);
    const nextTail = appendOutputTail(tail.stdout, chunkToText(chunk));
    tail.stdout = nextTail.text;
    tail.stdoutTruncated = tail.stdoutTruncated || nextTail.truncated;
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    process.stderr.write(chunk);
    const nextTail = appendOutputTail(tail.stderr, chunkToText(chunk));
    tail.stderr = nextTail.text;
    tail.stderrTruncated = tail.stderrTruncated || nextTail.truncated;
  });
  return tail;
}

function chunkToText(chunk: Buffer | string): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
}

function appendOutputTail(
  current: string,
  next: string,
): { text: string; truncated: boolean } {
  const combined = current + next;
  if (combined.length <= childOutputTailMaxLength) {
    return { text: combined, truncated: false };
  }
  return {
    text: combined.slice(combined.length - childOutputTailMaxLength),
    truncated: true,
  };
}

function formatUnexpectedCaseChildExit(
  reason: string,
  outputTail: CaseChildOutputTail,
): string {
  const stderr = stripTerminalControlCodes(outputTail.stderr).trim();
  const stdout = stripTerminalControlCodes(outputTail.stdout).trim();
  const headline = getChildStderrHeadline(stderr);
  const sections = [
    headline === null
      ? `${reason} before sending a structured case result.`
      : `Case child exited before sending a structured case result: ${headline}`,
    reason,
  ];
  if (stderr.length > 0) {
    sections.push(
      formatOutputSection('stderr', stderr, outputTail.stderrTruncated),
    );
  }
  if (stdout.length > 0) {
    sections.push(
      formatOutputSection('stdout', stdout, outputTail.stdoutTruncated),
    );
  }
  return sections.join('\n\n');
}

function formatChildExitReason(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal !== null) return `Case child exited with signal ${signal}`;
  return `Case child exited with code ${String(code)}`;
}

function getChildStderrHeadline(stderr: string): string | null {
  const line = stderr
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (line === undefined) return null;
  if (line.length <= outputHeadlineMaxLength) return line;
  return `${line.slice(0, outputHeadlineMaxLength)}...`;
}

function formatOutputSection(
  streamName: 'stderr' | 'stdout',
  output: string,
  truncated: boolean,
): string {
  const label = truncated
    ? `Case child ${streamName} (last ${String(output.length)} chars)`
    : `Case child ${streamName}`;
  return `${label}:\n${output}`;
}

function getCaseChildExecArgv(): string[] {
  const execArgv: string[] = [moduleMocksFlag];
  let skipNext = false;

  for (const arg of process.execArgv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === '--eval' || arg === '-e' || arg === '--print' || arg === '-p') {
      skipNext = true;
      continue;
    }

    if (arg.startsWith('--eval=') || arg.startsWith('--print=')) continue;
    if (arg === '--input-type' || arg.startsWith('--input-type=')) {
      if (arg === '--input-type') skipNext = true;
      continue;
    }
    if (arg === moduleMocksFlag) continue;
    if (isInspectArg(arg)) continue;

    execArgv.push(arg);
  }

  return execArgv;
}

function isInspectArg(arg: string): boolean {
  return (
    arg === inspectFlagPrefix ||
    arg.startsWith(`${inspectFlagPrefix}=`) ||
    arg === inspectBrkFlagPrefix ||
    arg.startsWith(`${inspectBrkFlagPrefix}=`)
  );
}

function resolveCaseChildEntrypoint(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (const fileName of ['caseChild.ts', 'caseChild.mjs', 'caseChild.js']) {
    const candidate = join(currentDir, fileName);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to locate the Agent Evals case child entrypoint.');
}
