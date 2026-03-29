import type { DisplayBlock, FileRef } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { monoFont } from '#src/style/helpers.ts';

const BlockWrapper = styled.div`
  margin-bottom: 12px;
`;

const BlockLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${colors.textSecondary.var};
  margin-bottom: 4px;
`;

const TextBlock = styled.p`
  white-space: pre-wrap;
`;

const MarkdownBlock = styled.div`
  white-space: pre-wrap;
  line-height: 1.6;
`;

const JsonBlock = styled.pre`
  ${monoFont}
  font-size: 12px;
  background: ${colors.bg.var};
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
`;

const ImageBlock = styled.img`
  max-width: 100%;
  border-radius: var(--radius-md);
`;

const AudioBlock = styled.audio`
  width: 100%;
`;

const VideoBlock = styled.video`
  max-width: 100%;
  border-radius: var(--radius-md);
`;

const FileLink = styled.a`
  color: ${colors.accent.var};
`;

type DisplayBlockRendererProps = {
  block: DisplayBlock;
};

export function DisplayBlockRenderer({ block }: DisplayBlockRendererProps) {
  return (
    <BlockWrapper>
      {block.label ? (
        <BlockLabel>
          {block.label}
        </BlockLabel>
      ) : null}
      {renderBlock(block)}
    </BlockWrapper>
  );
}

function renderBlock(block: DisplayBlock) {
  switch (block.kind) {
    case 'text':
      return <TextBlock>{block.text}</TextBlock>;

    case 'markdown':
      return (
        <MarkdownBlock
          dangerouslySetInnerHTML={{ __html: escapeHtml(block.text) }}
        />
      );

    case 'json':
      return (
        <JsonBlock>
          {JSON.stringify(block.value, null, 2)}
        </JsonBlock>
      );

    case 'image':
      return (
        <ImageBlock
          src={getFileUrl(block.ref)}
          alt={block.alt ?? ''}
        />
      );

    case 'audio':
      return (
        <AudioBlock
          controls
          src={getFileUrl(block.ref)}
        >
          {block.title}
        </AudioBlock>
      );

    case 'video':
      return (
        <VideoBlock
          controls
          src={getFileUrl(block.ref)}
        >
          {block.title}
        </VideoBlock>
      );

    case 'file':
      return (
        <FileLink
          href={getFileUrl(block.ref)}
          download
        >
          {block.title ?? 'Download file'}
        </FileLink>
      );

    default:
      return null;
  }
}

function getFileUrl(ref: FileRef): string {
  if (ref.source === 'repo') {
    const params = new URLSearchParams({ path: ref.path });
    if (ref.mimeType) {
      params.set('mimeType', ref.mimeType);
    }
    return `/api/repo-file?${params.toString()}`;
  }
  if (ref.source === 'run') {
    return `/api/artifacts/${ref.artifactId}`;
  }
  return '';
}

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const htmlEscapeRegex = /[&<>"']/g;

function escapeHtml(str: string): string {
  return str.replace(htmlEscapeRegex, (ch) => htmlEscapeMap[ch] ?? ch);
}
