import type { DisplayBlock, FileRef } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { JsonViewer } from './JsonViewer.tsx';

const BlockWrapper = styled.div`
  margin-bottom: 12px;
`;

const BlockLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${colors.textDim.var};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
`;

const TextBlock = styled.p`
  white-space: pre-wrap;
`;

const MarkdownBlock = styled.div`
  white-space: pre-wrap;
  line-height: 1.6;
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

type DisplayBlockRendererProps = { block: DisplayBlock };

export function DisplayBlockRenderer({ block }: DisplayBlockRendererProps) {
  return (
    <BlockWrapper>
      {block.label ? <BlockLabel>{block.label}</BlockLabel> : null}
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
      return <JsonViewer value={block.value} />;

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
  return `/api/artifacts/${ref.artifactId}`;
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
