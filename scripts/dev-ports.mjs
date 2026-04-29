import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultServerPort = 5100;
const defaultWebPort = 5200;

/**
 * @returns {{
 *   serverPort: number;
 *   webPort: number;
 * }}
 */
export function getDevPorts() {
  const envVars = readRepoEnvVars();

  return {
    serverPort: parsePort(
      envVars.AGENT_EVALS_DEV_SERVER_PORT ?? envVars.PORT,
      'AGENT_EVALS_DEV_SERVER_PORT',
      defaultServerPort,
    ),
    webPort: parsePort(
      envVars.AGENT_EVALS_DEV_WEB_PORT,
      'AGENT_EVALS_DEV_WEB_PORT',
      defaultWebPort,
    ),
  };
}

/**
 * @returns {Record<string, string>}
 */
function readRepoEnvVars() {
  const envFilePath = resolve(repoRoot, '.env');
  if (!existsSync(envFilePath)) {
    return {};
  }

  const envFileContents = readFileSync(envFilePath, 'utf8');
  /** @type {Record<string, string>} */
  const envVars = {};

  for (const line of envFileContents.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (
      trimmedLine.length === 0 ||
      trimmedLine.startsWith('#') ||
      !trimmedLine.includes('=')
    ) {
      continue;
    }

    const keyValueMatch =
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmedLine);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    envVars[key] = normalizeEnvValue(rawValue);
  }

  return envVars;
}

/**
 * @param {string} rawValue
 * @returns {string}
 */
function normalizeEnvValue(rawValue) {
  const trimmedValue = rawValue.trim();
  const quoteChar = trimmedValue[0];
  if (
    (quoteChar === '"' || quoteChar === "'") &&
    trimmedValue.at(-1) === quoteChar
  ) {
    return trimmedValue.slice(1, -1);
  }

  const commentIndex = trimmedValue.search(/\s#/u);
  if (commentIndex === -1) {
    return trimmedValue;
  }

  return trimmedValue.slice(0, commentIndex).trim();
}

/**
 * @param {string | undefined} rawValue
 * @param {string} envVarName
 * @param {number} fallbackPort
 * @returns {number}
 */
function parsePort(rawValue, envVarName, fallbackPort) {
  if (rawValue === undefined) {
    return fallbackPort;
  }

  const parsedPort = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(
      `${envVarName} must be a whole number between 1 and 65535. Received ${JSON.stringify(rawValue)}.`,
    );
  }

  return parsedPort;
}
