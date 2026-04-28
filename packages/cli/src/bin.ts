#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { runCli } from './cli.ts';

const moduleMocksFlag = '--experimental-test-module-mocks';
const inspectFlagPrefix = '--inspect';
const inspectBrkFlagPrefix = '--inspect-brk';

type DebugFlagParseResult = { argv: string[]; inspectArg: string | undefined };

function needsModuleMocksFlag(): boolean {
  return !process.execArgv.includes(moduleMocksFlag);
}

function parseDebugFlags(argv: string[]): DebugFlagParseResult {
  const nextArgv: string[] = [];
  let inspectArg: string | undefined;

  for (const arg of argv) {
    if (arg === inspectFlagPrefix || arg.startsWith(`${inspectFlagPrefix}=`)) {
      inspectArg = arg;
      continue;
    }

    if (
      arg === inspectBrkFlagPrefix ||
      arg.startsWith(`${inspectBrkFlagPrefix}=`)
    ) {
      inspectArg = arg;
      continue;
    }

    nextArgv.push(arg);
  }

  return { argv: nextArgv, inspectArg };
}

function isInspectArg(arg: string): boolean {
  return (
    arg === inspectFlagPrefix ||
    arg.startsWith(`${inspectFlagPrefix}=`) ||
    arg === inspectBrkFlagPrefix ||
    arg.startsWith(`${inspectBrkFlagPrefix}=`)
  );
}

function buildExecArgv(inspectArg: string | undefined): string[] {
  const execArgv = process.execArgv.filter(
    (arg) => arg !== moduleMocksFlag && !isInspectArg(arg),
  );
  const nextExecArgv = [moduleMocksFlag, ...execArgv];
  if (inspectArg !== undefined) {
    nextExecArgv.push(inspectArg);
  } else {
    nextExecArgv.push(...process.execArgv.filter(isInspectArg));
  }
  return nextExecArgv;
}

function execArgvMatches(nextExecArgv: string[]): boolean {
  return (
    process.execArgv.length === nextExecArgv.length &&
    process.execArgv.every((arg, index) => arg === nextExecArgv[index])
  );
}

async function reexecWithNodeArgs(
  argv: string[],
  execArgv: string[],
): Promise<void> {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Unable to locate the Agent Evals CLI entrypoint.');
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [...execArgv, entrypoint, ...argv], {
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      rejectPromise(error);
    });

    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        process.exitCode = 1;
        resolvePromise();
        return;
      }

      process.exitCode = code ?? 1;
      resolvePromise();
    });
  });
}

const { argv, inspectArg } = parseDebugFlags(process.argv.slice(2));
const execArgv = buildExecArgv(inspectArg);
if (needsModuleMocksFlag() || !execArgvMatches(execArgv)) {
  await reexecWithNodeArgs(argv, execArgv);
} else {
  await runCli(argv);
}
