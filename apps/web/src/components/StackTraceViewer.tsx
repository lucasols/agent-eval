import { ChevronDown, ChevronRight, SquareArrowOutUpRight } from 'lucide-react';
import { useState } from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { IconButton } from '#src/components/IconButton';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack } from '#src/style/helpers';
import { apiUrl } from '#src/utils/apiUrl';

export type StackFrameLocation = { file: string; line: number; column: number };

type StackTraceLine = {
  text: string;
  location: StackFrameLocation | undefined;
  rawLocationText: string | undefined;
};

type ParsedStackFrameLocation = {
  location: StackFrameLocation;
  rawLocationText: string;
};

const StackRoot = styled.div`
  ${stack({ gap: 6 })}
  min-width: 0;
`;

const PrimaryLocationRow = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  min-width: 0;
`;

const StackToggle = styled.button`
  ${inline({ gap: 6, align: 'center' })}
  align-self: flex-start;
  min-width: 0;
  border: none;
  background: transparent;
  color: ${colors.textMuted.var};
  padding: 2px 0;
  cursor: pointer;
  font-size: 11px;

  &:hover {
    color: ${colors.text.var};
  }

  & > svg {
    width: 13px;
    height: 13px;
  }
`;

const StackLines = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
  padding: 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
`;

const StackLineRow = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  min-width: 0;
`;

const StackLineText = styled.pre`
  ${monoFont};
  min-width: 0;
  flex: 1 1 auto;
  margin: 0;
  color: ${colors.text.var};
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0.82;
`;

const LocationText = styled.span`
  ${monoFont};
  min-width: 0;
  color: ${colors.text.var};
  font-size: 11px;
  word-break: break-all;
`;

const stackFrameLocationPattern =
  /(?:\((?<parenFile>.+):(?<parenLine>\d+):(?<parenColumn>\d+)\)|at (?<bareFile>.+):(?<bareLine>\d+):(?<bareColumn>\d+))$/;
const fileUrlPrefixPattern = /^file:\/\//;
const importQuerySeparatorRegex = /[?#]/;
const trailingSlashRegex = /\/$/;

export function StackTraceViewer({
  stack: stackText,
  primaryLocation,
  workspaceRoot,
  openButtonLabel = 'Open stack frame in editor',
}: {
  stack: string | undefined;
  primaryLocation?: StackFrameLocation | undefined;
  workspaceRoot: string;
  openButtonLabel?: string | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const stackLines =
    stackText !== undefined ? parseStackTraceLines(stackText) : [];
  const normalizedPrimaryLocation =
    primaryLocation !== undefined
      ? normalizeStackFrameLocation(primaryLocation)
      : stackLines.find((line) => line.location !== undefined)?.location;
  const hasExpandableStack = stackLines.length > 0;

  if (normalizedPrimaryLocation === undefined && !hasExpandableStack) {
    return null;
  }

  return (
    <StackRoot>
      {normalizedPrimaryLocation !== undefined ? (
        <PrimaryLocationRow>
          <LocationText>
            {formatFullStackLocation(normalizedPrimaryLocation, workspaceRoot)}
          </LocationText>
          <Tooltip content="Open in editor">
            <IconButton
              aria-label={openButtonLabel}
              onClick={() => {
                void openStackFrameInEditor(normalizedPrimaryLocation);
              }}
            >
              <SquareArrowOutUpRight />
            </IconButton>
          </Tooltip>
        </PrimaryLocationRow>
      ) : null}
      {hasExpandableStack ? (
        <>
          <StackToggle
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
            {expanded ? 'Hide stack' : 'Show stack'}
          </StackToggle>
          {expanded ? (
            <StackLines>
              {stackLines.map((line, index) => (
                <StackLine
                  key={`${line.text}-${String(index)}`}
                  line={line}
                  workspaceRoot={workspaceRoot}
                  openButtonLabel={openButtonLabel}
                />
              ))}
            </StackLines>
          ) : null}
        </>
      ) : null}
    </StackRoot>
  );
}

function StackLine({
  line,
  workspaceRoot,
  openButtonLabel,
}: {
  line: StackTraceLine;
  workspaceRoot: string;
  openButtonLabel: string;
}) {
  const location = line.location;
  return (
    <StackLineRow>
      <StackLineText>
        {location === undefined
          ? line.text
          : formatStackLineText(line, location, workspaceRoot)}
      </StackLineText>
      {location !== undefined ? (
        <Tooltip content="Open in editor">
          <IconButton
            aria-label={openButtonLabel}
            onClick={() => {
              void openStackFrameInEditor(location);
            }}
          >
            <SquareArrowOutUpRight />
          </IconButton>
        </Tooltip>
      ) : null}
    </StackLineRow>
  );
}

export function parseStackTraceLines(stackText: string): StackTraceLine[] {
  return stackText.split('\n').map((line) => {
    const parsedLocation = parseStackFrameLocation(line);
    return {
      text: line,
      location: parsedLocation?.location,
      rawLocationText: parsedLocation?.rawLocationText,
    };
  });
}

export function formatShortStackLocation(location: StackFrameLocation): string {
  const normalizedLocation = normalizeStackFrameLocation(location);
  const fileName =
    normalizedLocation.file.split('/').at(-1) ?? normalizedLocation.file;
  return `${fileName}:${String(normalizedLocation.line)}`;
}

function parseStackFrameLocation(
  line: string,
): ParsedStackFrameLocation | undefined {
  const match = stackFrameLocationPattern.exec(line.trim());
  const groups = match?.groups;
  if (groups === undefined) return undefined;
  const file = groups.parenFile ?? groups.bareFile;
  const lineNumber = Number(groups.parenLine ?? groups.bareLine);
  const column = Number(groups.parenColumn ?? groups.bareColumn);
  if (
    file === undefined ||
    !Number.isFinite(lineNumber) ||
    !Number.isFinite(column)
  ) {
    return undefined;
  }
  return {
    location: normalizeStackFrameLocation({ file, line: lineNumber, column }),
    rawLocationText: `${file}:${String(lineNumber)}:${String(column)}`,
  };
}

function normalizeStackFrameLocation(
  location: StackFrameLocation,
): StackFrameLocation {
  return { ...location, file: normalizeStackFile(location.file) };
}

function normalizeStackFile(file: string): string {
  const withoutQuery = file.split(importQuerySeparatorRegex, 1)[0] ?? file;
  if (!withoutQuery.startsWith('file://')) return withoutQuery;
  return decodeURIComponent(withoutQuery.replace(fileUrlPrefixPattern, ''));
}

function formatStackLineText(
  line: StackTraceLine,
  location: StackFrameLocation,
  workspaceRoot: string,
): string {
  if (line.rawLocationText === undefined) return line.text;
  return line.text.replace(
    line.rawLocationText,
    formatFullStackLocation(location, workspaceRoot),
  );
}

function formatFullStackLocation(
  location: StackFrameLocation,
  workspaceRoot: string,
): string {
  const file = formatWorkspaceRelativeFile(location.file, workspaceRoot);
  return `${file}:${String(location.line)}:${String(location.column)}`;
}

function formatWorkspaceRelativeFile(
  file: string,
  workspaceRoot: string,
): string {
  if (workspaceRoot.length === 0) return file;
  const normalizedFile = file.replaceAll('\\', '/');
  const normalizedRoot = workspaceRoot
    .replaceAll('\\', '/')
    .replace(trailingSlashRegex, '');
  if (normalizedFile === normalizedRoot) return '.';
  const rootPrefix = `${normalizedRoot}/`;
  if (normalizedFile.startsWith(rootPrefix)) {
    return normalizedFile.slice(rootPrefix.length);
  }
  return file;
}

async function openStackFrameInEditor(
  location: StackFrameLocation,
): Promise<void> {
  await resultify(() =>
    fetch(apiUrl('/api/runs/actions/open-location'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location),
    }),
  );
}
