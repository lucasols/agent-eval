import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import {
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { Modal } from '#src/components/Modal';
import { useImageLightbox } from '#src/components/useImageLightbox';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, transition } from '#src/style/helpers';
import {
  getEffectiveFileRefFormat,
  getFileLabel,
  getFileUrl,
} from '#src/utils/fileRefDisplay';
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

const ArtifactPreviewButton = styled.button`
  ${inline({ align: 'stretch', gap: 12 })}
  width: 100%;
  min-height: 76px;
  padding: 12px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  ${transition({ property: 'background, border-color' })}

  &:hover {
    background: ${colors.bgElevated.var};
    border-color: ${colors.accent.alpha(0.45)};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

const ArtifactDownloadLink = styled.a`
  ${inline({ align: 'stretch', gap: 12 })}
  width: 100%;
  min-height: 76px;
  padding: 12px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  ${transition({ property: 'background, border-color' })}

  &:hover {
    background: ${colors.bgElevated.var};
    border-color: ${colors.accent.alpha(0.45)};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

const ArtifactIconWrap = styled.span`
  ${inline({ align: 'center', justify: 'center' })}
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.accentDim.var};

  & svg {
    width: 18px;
    height: 18px;
  }
`;

const ArtifactPreviewMeta = styled.span`
  ${stack({ gap: 4 })}
  min-width: 0;
  flex: 1 1 auto;
`;

const ArtifactPreviewTitle = styled.span`
  color: ${colors.text.var};
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ArtifactPreviewSubtitle = styled.span`
  ${inline({ align: 'center', gap: 8 })}
  min-width: 0;
  max-width: 100%;
  color: ${colors.textMuted.var};
  font-size: 12px;
`;

const ArtifactPreviewSubtitleText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ArtifactPreviewSize = styled.span`
  flex: 0 0 auto;
  color: ${colors.textDim.var};
  white-space: nowrap;
`;

const ArtifactPreviewAction = styled.span`
  ${inline({ align: 'center', justify: 'center' })}
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};

  & svg {
    width: 14px;
    height: 14px;
  }
`;

const PreviewFrameWrap = styled.div`
  width: min(100%, 1120px);
  height: min(74vh, 820px);
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.white.var};
  overflow: hidden;
`;

const PreviewFrame = styled.iframe`
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  background: ${colors.white.var};
`;

const PreviewHeaderLink = styled.a`
  ${inline({ align: 'center', gap: 7 })}
  ${transition({ property: 'background, border-color, color' })}
  height: 32px;
  padding: 0 14px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.surface.var};
  color: ${colors.text.var};
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.accent.alpha(0.45)};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }

  & svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }
`;

export function FormattedCellValue({
  def,
  value,
  inferMarkdown = false,
  markdownRawToggle = false,
  previewFooter,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
  inferMarkdown?: boolean;
  markdownRawToggle?: boolean;
  previewFooter?: ReactNode;
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

  const fileRef = isFileRef(value) ? value : undefined;
  const fileFormat =
    fileRef === undefined ? undefined : getEffectiveFileRefFormat(def, fileRef);

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

  if (fileFormat === 'image' && fileRef !== undefined) {
    return (
      <ImageCell
        src={getFileUrl(fileRef)}
        alt={def.label}
        previewFooter={previewFooter}
      />
    );
  }

  if (
    (fileFormat === 'html' || fileFormat === 'pdf') &&
    fileRef !== undefined
  ) {
    return (
      <ArtifactPreviewCell
        kind={fileFormat}
        src={getFileUrl(fileRef)}
        title={def.label}
        fileName={getFileLabel(fileRef)}
        sizeBytes={fileRef.sizeBytes}
        previewFooter={previewFooter}
      />
    );
  }

  if (fileFormat === 'audio' && fileRef !== undefined) {
    return (
      <AudioValue
        controls
        src={getFileUrl(fileRef)}
      />
    );
  }

  if (fileFormat === 'video' && fileRef !== undefined) {
    return (
      <VideoValue
        controls
        src={getFileUrl(fileRef)}
      />
    );
  }

  if (fileFormat === 'file' && fileRef !== undefined) {
    return (
      <ArtifactDownloadCell
        src={getFileUrl(fileRef)}
        title={def.label}
        fileName={getFileLabel(fileRef)}
        sizeBytes={fileRef.sizeBytes}
      />
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

function ImageCell({
  src,
  alt,
  previewFooter,
}: {
  src: string;
  alt: string;
  previewFooter: ReactNode | undefined;
}) {
  const { openImage, lightbox } = useImageLightbox({ footer: previewFooter });
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

function ArtifactPreviewCell({
  kind,
  src,
  title,
  fileName,
  sizeBytes,
  previewFooter,
}: {
  kind: 'html' | 'pdf';
  src: string;
  title: string;
  fileName: string;
  sizeBytes: number | undefined;
  previewFooter: ReactNode | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = kind === 'html' ? FileCode2 : FileText;
  const typeLabel = kind === 'html' ? 'HTML preview' : 'PDF preview';

  return (
    <>
      <ArtifactPreviewButton
        type="button"
        aria-label={`Open ${title} preview`}
        onClick={() => setIsOpen(true)}
      >
        <ArtifactIconWrap>
          <Icon />
        </ArtifactIconWrap>
        <ArtifactPreviewMeta>
          <ArtifactPreviewTitle>{title}</ArtifactPreviewTitle>
          <ArtifactPreviewSubtitle>
            <ArtifactPreviewSubtitleText>
              {formatArtifactSubtitleText({ actionLabel: typeLabel, fileName })}
            </ArtifactPreviewSubtitleText>
            <ArtifactSizeLabel sizeBytes={sizeBytes} />
          </ArtifactPreviewSubtitle>
        </ArtifactPreviewMeta>
        <ArtifactPreviewAction>
          <Eye />
        </ArtifactPreviewAction>
      </ArtifactPreviewButton>
      <ArtifactPreviewModal
        isOpen={isOpen}
        kind={kind}
        src={src}
        title={title}
        fileName={fileName}
        footer={previewFooter}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function ArtifactSizeLabel({ sizeBytes }: { sizeBytes: number | undefined }) {
  const formattedSize = formatBytes(sizeBytes);
  if (formattedSize === undefined) return null;
  return <ArtifactPreviewSize>{formattedSize}</ArtifactPreviewSize>;
}

function ArtifactDownloadCell({
  src,
  title,
  fileName,
  sizeBytes,
}: {
  src: string;
  title: string;
  fileName: string;
  sizeBytes: number | undefined;
}) {
  return (
    <ArtifactDownloadLink
      href={src}
      download
      aria-label={`Download ${title}`}
    >
      <ArtifactIconWrap>
        <FileText />
      </ArtifactIconWrap>
      <ArtifactPreviewMeta>
        <ArtifactPreviewTitle>{title}</ArtifactPreviewTitle>
        <ArtifactPreviewSubtitle>
          <ArtifactPreviewSubtitleText>
            {formatArtifactSubtitleText({
              actionLabel: 'File download',
              fileName,
            })}
          </ArtifactPreviewSubtitleText>
          <ArtifactSizeLabel sizeBytes={sizeBytes} />
        </ArtifactPreviewSubtitle>
      </ArtifactPreviewMeta>
      <ArtifactPreviewAction>
        <Download />
      </ArtifactPreviewAction>
    </ArtifactDownloadLink>
  );
}

function ArtifactPreviewModal({
  isOpen,
  kind,
  src,
  title,
  fileName,
  footer,
  onClose,
}: {
  isOpen: boolean;
  kind: 'html' | 'pdf';
  src: string;
  title: string;
  fileName: string;
  footer: ReactNode | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      subtitle={fileName}
      onClose={onClose}
      wide
      topLayer
      footer={footer}
      headerActions={
        <PreviewHeaderLink
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink />
          Open in new tab
        </PreviewHeaderLink>
      }
    >
      <PreviewFrameWrap>
        <PreviewFrame
          title={`${title} preview`}
          src={src}
          sandbox={kind === 'html' ? '' : undefined}
        />
      </PreviewFrameWrap>
    </Modal>
  );
}

function formatArtifactSubtitleText({
  actionLabel,
  fileName,
}: {
  actionLabel: string;
  fileName: string;
}): string {
  return `${actionLabel} - ${fileName}`;
}

function formatBytes(sizeBytes: number | undefined): string | undefined {
  if (sizeBytes === undefined) return undefined;
  if (!Number.isFinite(sizeBytes)) return undefined;

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const unit = units[unitIndex];
  if (unit === undefined) return undefined;
  if (unitIndex === 0) return `${String(sizeBytes)} ${unit}`;
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
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
    def.format === 'html' ||
    def.format === 'pdf' ||
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
