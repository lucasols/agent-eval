import { Download } from 'lucide-react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { useImageLightbox } from '#src/components/useImageLightbox';
import { colors } from '#src/style/colors';
import { inline, kicker, stack, transition } from '#src/style/helpers';
import {
  formatFileSize,
  getManualInputFileUrl,
  isManualInputFileValue,
  type ManualInputFileValue,
} from '#src/utils/manualInputFile';

const Layout = styled.div`
  ${stack({ gap: 14 })}
  min-width: 0;
`;

const FileGroup = styled.div`
  ${stack({ gap: 10 })}
`;

const GroupKicker = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const FileCard = styled.div`
  ${stack({ gap: 10 })}
  padding: 12px;
  border: 1px solid ${colors.border.var};
  border-radius: 8px;
  background: ${colors.bg.var};
`;

const FileHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
`;

const FileMeta = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
`;

const FieldKey = styled.span`
  font-size: 11px;
  color: ${colors.textMuted.var};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
`;

const FileName = styled.span`
  font-size: 13px;
  color: ${colors.text.var};
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileSub = styled.span`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const DownloadLink = styled.a`
  ${inline({ align: 'center', gap: 6 })}
  font-size: 12px;
  color: ${colors.textMuted.var};
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 6px;
  ${transition({ property: 'background, color' })}

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }
`;

const ImageThumb = styled.img`
  max-width: 100%;
  max-height: 240px;
  border-radius: 6px;
  object-fit: contain;
  background: ${colors.surface.var};
  cursor: zoom-in;
`;

type InputViewerProps = { value: unknown };

type FileEntry = { key: string; file: ManualInputFileValue };

function partitionInput(value: unknown): {
  files: FileEntry[];
  rest: Record<string, unknown> | null;
} {
  if (typeof value !== 'object' || value === null) {
    return { files: [], rest: null };
  }
  const files: FileEntry[] = [];
  const rest: Record<string, unknown> = {};
  let restHasKeys = false;
  for (const [key, child] of Object.entries({ ...value })) {
    if (isManualInputFileValue(child)) {
      files.push({ key, file: child });
    } else {
      rest[key] = child;
      restHasKeys = true;
    }
  }
  return { files, rest: restHasKeys ? rest : null };
}

function FilePreview({ entry }: { entry: FileEntry }) {
  const { key, file } = entry;
  const isImage = file.mimeType.startsWith('image/');
  const downloadName = file.name || `${key}.bin`;
  const fileUrl = getManualInputFileUrl(file);
  const { openImage, lightbox } = useImageLightbox();
  return (
    <FileCard>
      <FileHeader>
        <FileMeta>
          <FieldKey>{key}</FieldKey>
          <FileName title={file.name}>{file.name || 'Pasted file'}</FileName>
          <FileSub>
            {file.mimeType || 'application/octet-stream'} ·{' '}
            {formatFileSize(file.sizeBytes)}
          </FileSub>
        </FileMeta>
        <DownloadLink
          href={fileUrl}
          download={downloadName}
        >
          <Download size={14} />
          Download
        </DownloadLink>
      </FileHeader>
      {isImage ? (
        <ImageThumb
          src={fileUrl}
          alt={file.name}
          onClick={() => openImage(fileUrl, file.name || key)}
        />
      ) : null}
      {lightbox}
    </FileCard>
  );
}

/**
 * Render a case input. Top-level fields whose value is a manual-input file
 * (`{ name, mimeType, sizeBytes, sha256, path }`) are previewed as images or labelled
 * file cards with a download link; the remaining fields fall back to the
 * standard JSON viewer.
 */
export function InputViewer({ value }: InputViewerProps) {
  const { files, rest } = partitionInput(value);
  if (files.length === 0) {
    return <JsonViewer value={value} />;
  }
  return (
    <Layout>
      <FileGroup>
        <GroupKicker>Files</GroupKicker>
        {files.map((entry) => (
          <FilePreview
            key={entry.key}
            entry={entry}
          />
        ))}
      </FileGroup>
      {rest ? (
        <FileGroup>
          <GroupKicker>Other input</GroupKicker>
          <JsonViewer value={rest} />
        </FileGroup>
      ) : null}
    </Layout>
  );
}
