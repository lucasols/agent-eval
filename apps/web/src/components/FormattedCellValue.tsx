import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import { Code2, Eye } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { useImageLightbox } from '#src/components/useImageLightbox';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, transition } from '#src/style/helpers';
import { apiUrl } from '#src/utils/apiUrl';
import {
  formatDuration,
  formatNumber,
  formatPassFail,
  formatPercent,
  formatStars,
} from '#src/utils/formatters';

const TextValue = styled.p`
  white-space: pre-wrap;
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
`;

const RawTextValue = styled.pre`
  ${monoFont};
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
`;

const MarkdownBlock = styled.div`
  ${stack({ gap: 6 })}
`;

const MarkdownToolbar = styled.div`
  ${inline()}
`;

const MarkdownToggle = styled.div`
  ${inline()}
  padding: 1px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
`;

const MarkdownToggleButton = styled.button<{ active: boolean }>`
  ${inline({ align: 'center', gap: 5 })}
  ${transition({ property: 'background, color' })}
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: ${colors.textMuted.var};
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  & svg {
    width: 10px;
    height: 10px;
  }
`;

const MarkdownValue = styled.div`
  color: ${colors.text.var};
  font-size: 13px;
  line-height: 1.55;

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
    margin: 0 0 10px;
  }

  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    margin: 0 0 10px;
    color: ${colors.text.var};
    line-height: 1.25;
  }

  & h1 {
    font-size: 18px;
  }

  & h2 {
    font-size: 15px;
  }

  & h3 {
    font-size: 13.5px;
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
  cursor: zoom-in;
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
  inferMarkdown = false,
  markdownRawToggle = false,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
  inferMarkdown?: boolean;
  markdownRawToggle?: boolean;
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

  if (
    typeof value === 'string' &&
    shouldRenderAsMarkdown({ def, value, inferMarkdown })
  ) {
    return (
      <MarkdownCell
        value={value}
        rawToggle={markdownRawToggle}
      />
    );
  }

  if (def.format === 'image' && isFileRef(value)) {
    return (
      <ImageCell
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
    if (def.format === 'number') return formatNumber(value, def.numberFormat);
    if (def.format === 'duration') return formatDuration(value);
    if (def.format === 'percent') return formatPercent(value);
    if (def.format === 'passFail') return formatPassFail(value);
    if (def.format === 'stars') return formatStars(value, def.maxStars);
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

function MarkdownCell({
  value,
  rawToggle,
}: {
  value: string;
  rawToggle: boolean;
}) {
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered');
  if (!rawToggle) {
    return (
      <MarkdownValue>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </MarkdownValue>
    );
  }

  return (
    <MarkdownBlock>
      {mode === 'rendered' ? (
        <MarkdownValue>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </MarkdownValue>
      ) : (
        <RawTextValue>{value}</RawTextValue>
      )}
      <MarkdownToolbar>
        <MarkdownToggle>
          <MarkdownToggleButton
            type="button"
            active={mode === 'rendered'}
            aria-pressed={mode === 'rendered'}
            onClick={() => setMode('rendered')}
          >
            <Eye />
            Preview
          </MarkdownToggleButton>
          <MarkdownToggleButton
            type="button"
            active={mode === 'raw'}
            aria-pressed={mode === 'raw'}
            onClick={() => setMode('raw')}
          >
            <Code2 />
            Raw
          </MarkdownToggleButton>
        </MarkdownToggle>
      </MarkdownToolbar>
    </MarkdownBlock>
  );
}

function shouldRenderAsMarkdown({
  def,
  value,
  inferMarkdown,
}: {
  def: ColumnDef;
  value: string;
  inferMarkdown: boolean;
}): boolean {
  return (
    def.format === 'markdown' || (inferMarkdown && inferMarkdownText(value))
  );
}

function inferMarkdownText(value: string): boolean {
  if (!value.trim()) return false;
  return markdownSignals.some((signal) => signal.test(value));
}

const markdownSignals = [
  /^#{1,6}\s+\S/m,
  /^[-*+]\s+\S/m,
  /^\d+\.\s+\S/m,
  /^>\s+\S/m,
  /^```/m,
  /^[-*_]{3,}\s*$/m,
  /^\|.+\|\s*$/m,
  /(?:^|\s)(?:\*\*|__)\S[\s\S]*?\S(?:\*\*|__)(?:\s|$)/,
  /(?:^|\s)`[^`\n]+`(?:\s|$)/,
  /!?\[[^\]\n]+\]\([^)]+\)/,
];

function ImageCell({ src, alt }: { src: string; alt: string }) {
  const { openImage, lightbox } = useImageLightbox();
  return (
    <>
      <ImageValue
        src={src}
        alt={alt}
        onClick={() => openImage(src, alt)}
      />
      {lightbox}
    </>
  );
}

export function summarizeCellValue(
  def: ColumnDef,
  value: CellValue | undefined,
): string {
  if (value === undefined || value === null) return '\u2014';
  if (typeof value === 'number') {
    if (def.format === 'number') return formatNumber(value, def.numberFormat);
    if (def.format === 'duration') return formatDuration(value);
    if (def.format === 'percent') return formatPercent(value);
    if (def.format === 'passFail') return formatPassFail(value);
    if (def.format === 'stars') return formatStars(value, def.maxStars);
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
    return apiUrl(`/api/repo-file?${params.toString()}`);
  }
  const params = new URLSearchParams({ mimeType: ref.mimeType });
  if (ref.fileName) {
    params.set('fileName', ref.fileName);
  }
  return apiUrl(`/api/artifacts/${ref.artifactId}?${params.toString()}`);
}

function getFileLabel(ref: FileRef): string {
  if (ref.source === 'repo') {
    return ref.path.split('/').at(-1) ?? ref.path;
  }
  return ref.fileName ?? ref.artifactId;
}
