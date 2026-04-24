#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { runCli } from './cli.ts';

const moduleMocksFlag = '--experimental-test-module-mocks';

function needsModuleMocksFlag(): boolean {
  return !process.execArgv.includes(moduleMocksFlag);
}

async function reexecWithModuleMocksFlag(argv: string[]): Promise<void> {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Unable to locate the Agent Evals CLI entrypoint.');
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [moduleMocksFlag, ...process.execArgv, entrypoint, ...argv],
      { env: process.env, stdio: 'inherit' },
    );

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

const argv = process.argv.slice(2);
if (needsModuleMocksFlag()) {
  await reexecWithModuleMocksFlag(argv);
} else {
  await runCli(argv);
}
