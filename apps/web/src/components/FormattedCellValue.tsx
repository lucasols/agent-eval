import type { CellValue, ColumnDef, FileRef } from '@agent-evals/shared';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { Modal } from '#src/components/Modal';
import { Tooltip } from '#src/components/Tooltip';
import { useImageLightbox } from '#src/components/useImageLightbox';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, transition } from '#src/style/helpers';
import {
  getEffectiveFileRefFormat,
  getFileLabel,
  getFileUrl,
  isPreviewableFileRefFormat,
  type PreviewableFileRefFormat,
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

const PreviewImage = styled.img`
  display: block;
  max-width: 100%;
  max-height: min(74vh, 820px);
  margin: 0 auto;
  border-radius: var(--radius-md);
`;

const PreviewAudio = styled.audio`
  width: min(720px, 100%);
`;

const PreviewVideo = styled.video`
  display: block;
  width: min(100%, 960px);
  max-height: min(74vh, 820px);
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

const PreviewHeaderActions = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const PreviewNav = styled.div`
  ${inline({ align: 'center', gap: 6 })}
`;

const PreviewNavButton = styled.button`
  ${inline({ align: 'center', justify: 'center' })}
  ${transition({ property: 'background, border-color, color' })}
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.surface.var};
  color: ${colors.text.var};
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.accent.alpha(0.45)};
  }

  &:disabled {
    color: ${colors.textDim.var};
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }

  & svg {
    width: 15px;
    height: 15px;
  }
`;

const PreviewSelect = styled.select`
  ${transition({ property: 'background, border-color' })}
  width: min(220px, 24vw);
  height: 32px;
  padding: 0 28px 0 10px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.surface.var};
  color: ${colors.text.var};
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.accent.alpha(0.45)};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

export type MediaPreviewFormat = PreviewableFileRefFormat;

export type MediaPreviewItem = {
  id: string;
  format: MediaPreviewFormat;
  src: string;
  title: string;
  fileName: string;
  sizeBytes: number | undefined;
};

export function FormattedCellValue({
  def,
  value,
  inferMarkdown = false,
  markdownRawToggle = false,
  previewFooter,
  previewItems,
  previewItemId,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
  inferMarkdown?: boolean;
  markdownRawToggle?: boolean;
  previewFooter?: ReactNode;
  previewItems?: MediaPreviewItem[];
  previewItemId?: string;
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

  if (
    fileRef !== undefined &&
    fileFormat !== undefined &&
    isPreviewableFileRefFormat(fileFormat)
  ) {
    const currentPreviewItem = toMediaPreviewItem({
      def,
      fileRef,
      format: fileFormat,
      id: previewItemId,
    });
    const effectivePreviewItems = getEffectivePreviewItems(
      currentPreviewItem,
      previewItems,
    );
    if (fileFormat === 'image') {
      return (
        <ImageCell
          src={currentPreviewItem.src}
          alt={def.label}
          previewFooter={previewFooter}
          previewItems={effectivePreviewItems}
          previewItemId={currentPreviewItem.id}
        />
      );
    }

    return (
      <ArtifactPreviewCell
        item={currentPreviewItem}
        previewItems={effectivePreviewItems}
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
  previewItems,
  previewItemId,
}: {
  src: string;
  alt: string;
  previewFooter: ReactNode | undefined;
  previewItems: MediaPreviewItem[];
  previewItemId: string;
}) {
  const { openImage, lightbox } = useImageLightbox({ footer: previewFooter });
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  return (
    <>
      <ImageValue
        src={src}
        alt={alt}
        onClick={() => {
          if (previewItems.length > 1) {
            setActivePreviewId(previewItemId);
            return;
          }
          openImage(src, alt);
        }}
      />
      <MediaPreviewModal
        isOpen={activePreviewId !== null}
        items={previewItems}
        activeItemId={activePreviewId ?? previewItemId}
        footer={previewFooter}
        onChange={setActivePreviewId}
        onClose={() => setActivePreviewId(null)}
      />
      {lightbox}
    </>
  );
}

function ArtifactPreviewCell({
  item,
  previewItems,
  previewFooter,
}: {
  item: MediaPreviewItem;
  previewItems: MediaPreviewItem[];
  previewFooter: ReactNode | undefined;
}) {
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const Icon = getPreviewIcon(item.format);
  const typeLabel = getPreviewTypeLabel(item.format);

  return (
    <>
      <ArtifactPreviewButton
        type="button"
        aria-label={`Open ${item.title} preview`}
        onClick={() => setActivePreviewId(item.id)}
      >
        <ArtifactIconWrap>
          <Icon />
        </ArtifactIconWrap>
        <ArtifactPreviewMeta>
          <ArtifactPreviewTitle>{item.title}</ArtifactPreviewTitle>
          <ArtifactPreviewSubtitle>
            <ArtifactPreviewSubtitleText>
              {formatArtifactSubtitleText({
                actionLabel: typeLabel,
                fileName: item.fileName,
              })}
            </ArtifactPreviewSubtitleText>
            <ArtifactSizeLabel sizeBytes={item.sizeBytes} />
          </ArtifactPreviewSubtitle>
        </ArtifactPreviewMeta>
        <ArtifactPreviewAction>
          <Eye />
        </ArtifactPreviewAction>
      </ArtifactPreviewButton>
      <MediaPreviewModal
        isOpen={activePreviewId !== null}
        items={previewItems}
        activeItemId={activePreviewId ?? item.id}
        footer={previewFooter}
        onChange={setActivePreviewId}
        onClose={() => setActivePreviewId(null)}
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

export function MediaPreviewModal({
  isOpen,
  items,
  activeItemId,
  footer,
  onChange,
  onClose,
}: {
  isOpen: boolean;
  items: MediaPreviewItem[];
  activeItemId: string;
  footer: ReactNode | undefined;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  const activeIndex = items.findIndex((item) => item.id === activeItemId);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : items[0];
  if (activeItem === undefined) return null;

  const canNavigate = items.length > 1;
  const displayIndex = activeIndex >= 0 ? activeIndex : 0;

  function changeBy(delta: -1 | 1) {
    if (!canNavigate) return;
    const nextIndex = (displayIndex + delta + items.length) % items.length;
    const nextItem = items[nextIndex];
    if (nextItem !== undefined) onChange(nextItem.id);
  }

  return (
    <Modal
      isOpen={isOpen}
      title={activeItem.title}
      subtitle={activeItem.fileName}
      onClose={onClose}
      wide
      topLayer
      footer={footer}
      headerActions={
        <PreviewHeaderActions>
          {canNavigate ? (
            <PreviewNav>
              <Tooltip content="Previous preview">
                <PreviewNavButton
                  type="button"
                  aria-label="Previous preview"
                  onClick={() => changeBy(-1)}
                >
                  <ChevronLeft />
                </PreviewNavButton>
              </Tooltip>
              <PreviewSelect
                aria-label="Select preview"
                value={activeItem.id}
                onChange={(event) => onChange(event.currentTarget.value)}
              >
                {items.map((item, index) => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {`${String(index + 1)}. ${item.title}`}
                  </option>
                ))}
              </PreviewSelect>
              <Tooltip content="Next preview">
                <PreviewNavButton
                  type="button"
                  aria-label="Next preview"
                  onClick={() => changeBy(1)}
                >
                  <ChevronRight />
                </PreviewNavButton>
              </Tooltip>
            </PreviewNav>
          ) : null}
          <PreviewHeaderLink
            href={activeItem.src}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink />
            Open in new tab
          </PreviewHeaderLink>
        </PreviewHeaderActions>
      }
    >
      <MediaPreviewContent item={activeItem} />
    </Modal>
  );
}

function MediaPreviewContent({ item }: { item: MediaPreviewItem }) {
  if (item.format === 'image') {
    return (
      <PreviewImage
        src={item.src}
        alt={item.title}
      />
    );
  }
  if (item.format === 'audio') {
    return (
      <PreviewAudio
        controls
        src={item.src}
      />
    );
  }
  if (item.format === 'video') {
    return (
      <PreviewVideo
        controls
        src={item.src}
      />
    );
  }

  return (
    <PreviewFrameWrap>
      <PreviewFrame
        title={`${item.title} preview`}
        src={item.src}
        sandbox={item.format === 'html' ? '' : undefined}
      />
    </PreviewFrameWrap>
  );
}

export function getMediaPreviewItemId(def: ColumnDef, ref: FileRef): string {
  if (ref.source === 'repo') return `${def.key}:repo:${ref.path}`;
  return `${def.key}:run:${ref.artifactId}`;
}

export function toMediaPreviewItem({
  def,
  fileRef,
  format,
  id,
}: {
  def: ColumnDef;
  fileRef: FileRef;
  format: MediaPreviewFormat;
  id?: string | undefined;
}): MediaPreviewItem {
  return {
    id: id ?? getMediaPreviewItemId(def, fileRef),
    format,
    src: getFileUrl(fileRef),
    title: def.label,
    fileName: getFileLabel(fileRef),
    sizeBytes: fileRef.sizeBytes,
  };
}

function getEffectivePreviewItems(
  currentItem: MediaPreviewItem,
  previewItems: MediaPreviewItem[] | undefined,
): MediaPreviewItem[] {
  if (previewItems === undefined || previewItems.length === 0) {
    return [currentItem];
  }
  if (previewItems.some((item) => item.id === currentItem.id)) {
    return previewItems;
  }
  return [currentItem, ...previewItems];
}

export function getMediaPreviewItemsForColumns(
  columnDefs: ColumnDef[],
  columns: Record<string, CellValue | undefined>,
): MediaPreviewItem[] {
  return columnDefs.flatMap((def) => {
    const value = columns[def.key];
    if (!isFileRef(value)) return [];
    const format = getEffectiveFileRefFormat(def, value);
    if (!isPreviewableFileRefFormat(format)) return [];
    return [toMediaPreviewItem({ def, fileRef: value, format })];
  });
}

export function getEffectiveMediaPreviewItems(
  currentItem: MediaPreviewItem,
  mediaPreviewItems: MediaPreviewItem[],
): MediaPreviewItem[] {
  if (mediaPreviewItems.length === 0) return [currentItem];
  if (mediaPreviewItems.some((item) => item.id === currentItem.id)) {
    return mediaPreviewItems;
  }
  return [currentItem, ...mediaPreviewItems];
}

function getPreviewIcon(format: MediaPreviewFormat) {
  switch (format) {
    case 'image':
      return FileImage;
    case 'html':
      return FileCode2;
    case 'pdf':
      return FileText;
    case 'audio':
      return FileAudio;
    case 'video':
      return FileVideo;
  }
}

function getPreviewTypeLabel(format: MediaPreviewFormat): string {
  switch (format) {
    case 'image':
      return 'Image preview';
    case 'html':
      return 'HTML preview';
    case 'pdf':
      return 'PDF preview';
    case 'audio':
      return 'Audio preview';
    case 'video':
      return 'Video preview';
  }
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

function isFileRef(value: CellValue | undefined): value is FileRef {
  if (typeof value !== 'object' || value === null || !('source' in value)) {
    return false;
  }
  return value.source === 'repo' || value.source === 'run';
}
