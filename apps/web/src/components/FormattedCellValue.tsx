import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { monoFont } from '#src/style/helpers';
import {
  formatCost,
  formatDuration,
  formatPercent,
} from '../utils/formatters.ts';
import { JsonViewer } from './JsonViewer.tsx';

const TextValue = styled.p`
  white-space: pre-wrap;
  margin: 0;
`;

const MarkdownValue = styled.div`
  color: ${colors.text.var};
  line-height: 1.6;

  & > :first-child {
    margin-top: 0;
  }

  & > :last-child {
    margin-bottom: 0;
  }

  & p,
  & ul,
  & ol,
  & blockquote,
  & pre,
  & table {
    margin: 0 0 12px;
  }

  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    margin: 0 0 12px;
    color: ${colors.text.var};
    line-height: 1.25;
  }

  & h1 {
    font-size: 22px;
  }

  & h2 {
    font-size: 18px;
  }

  & h3 {
    font-size: 15px;
  }

  & ul,
  & ol {
    padding-left: 20px;
  }

  & li + li {
    margin-top: 4px;
  }

  & code {
    ${monoFont};
    font-size: 12px;
    background: ${colors.surface.var};
    border: 1px solid ${colors.border.var};
    border-radius: 6px;
    padding: 1px 5px;
  }

  & pre {
    ${monoFont};
    font-size: 12px;
    overflow-x: auto;
    background: ${colors.surface.var};
    border: 1px solid ${colors.border.var};
    border-radius: var(--radius-sm);
    padding: 12px;
  }

  & pre code {
    background: transparent;
    border: none;
    padding: 0;
    font-size: inherit;
  }

  & blockquote {
    padding-left: 12px;
    border-left: 3px solid ${colors.border.var};
    color: ${colors.textMuted.var};
  }

  & a {
    color: ${colors.accent.var};
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  & table {
    width: 100%;
    border-collapse: collapse;
  }

  & th,
  & td {
    border: 1px solid ${colors.border.var};
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }

  & th {
    background: ${colors.surface.var};
  }
`;

const ImageValue = styled.img`
  max-width: 100%;
  border-radius: var(--radius-md);
`;

const AudioValue = styled.audio`
  width: 100%;
`;

const VideoValue = styled.video`
  max-width: 100%;
  border-radius: var(--radius-md);
`;

const FileLink = styled.a`
  color: ${colors.accent.var};
`;

export function FormattedCellValue({
  def,
  value,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
}) {
  if (value === undefined || value === null) return '\u2014';

  if (def.format === 'json' && typeof value === 'object') {
    return (
      <JsonViewer
        value={value}
        compact
        maxHeight="detail"
        collapsed={2}
      />
    );
  }

  if (def.format === 'markdown' && typeof value === 'string') {
    return (
      <MarkdownValue>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </MarkdownValue>
    );
  }

  if (def.format === 'image' && isFileRef(value)) {
    return (
      <ImageValue
        src={getFileUrl(value)}
        alt={def.label}
      />
    );
  }

  if (def.format === 'audio' && isFileRef(value)) {
    return (
      <AudioValue
        controls
        src={getFileUrl(value)}
      />
    );
  }

  if (def.format === 'video' && isFileRef(value)) {
    return (
      <VideoValue
        controls
        src={getFileUrl(value)}
      />
    );
  }

  if (def.format === 'file' && isFileRef(value)) {
    return (
      <FileLink
        href={getFileUrl(value)}
        download
      >
        {getFileLabel(value)}
      </FileLink>
    );
  }

  if (typeof value === 'number') {
    if (def.format === 'usd') return formatCost(value);
    if (def.format === 'duration') return formatDuration(value);
    if (def.format === 'percent') return formatPercent(value);
    return String(value);
  }

  if (typeof value === 'object') {
    return (
      <JsonViewer
        value={value}
        compact
        maxHeight="detail"
        collapsed={2}
      />
    );
  }

  return <TextValue>{String(value)}</TextValue>;
}

export function summarizeCellValue(
  def: ColumnDef,
  value: CellValue | undefined,
): string {
  if (value === undefined || value === null) return '\u2014';
  if (typeof value === 'number') {
    if (def.format === 'usd') return formatCost(value);
    if (def.format === 'duration') return formatDuration(value);
    if (def.format === 'percent') return formatPercent(value);
    return String(value);
  }
  if (def.format === 'json' && typeof value === 'object') return 'JSON';
  if (isFileRef(value)) return getFileLabel(value);
  if (typeof value === 'object') return 'JSON';
  return String(value);
}

export function hasRichColumnFormat(def: ColumnDef): boolean {
  return (
    def.format === 'markdown' ||
    def.format === 'json' ||
    def.format === 'image' ||
    def.format === 'audio' ||
    def.format === 'video' ||
    def.format === 'file'
  );
}

function isFileRef(value: CellValue): value is FileRef {
  if (typeof value !== 'object' || value === null || !('source' in value)) {
    return false;
  }
  return value.source === 'repo' || value.source === 'run';
}

function getFileUrl(ref: FileRef): string {
  if (ref.source === 'repo') {
    const params = new URLSearchParams({ path: ref.path });
    if (ref.mimeType) {
      params.set('mimeType', ref.mimeType);
    }
    return `/api/repo-file?${params.toString()}`;
  }
  return `/api/artifacts/${ref.artifactId}`;
}

function getFileLabel(ref: FileRef): string {
  if (ref.source === 'repo') {
    return ref.path.split('/').at(-1) ?? ref.path;
  }
  return ref.fileName ?? ref.artifactId;
}
