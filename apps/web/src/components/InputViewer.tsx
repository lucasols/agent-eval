import {
  fileRefSchema,
  type CaseInputSection,
  type CellValue,
  type FileRef,
} from '@agent-evals/shared';
import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { styled } from 'vindur';
import { FormattedCellValue } from '#src/components/FormattedCellValue';
import { JsonViewer } from '#src/components/JsonViewer';
import { Tooltip } from '#src/components/Tooltip';
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

const InputSectionList = styled.div`
  ${stack()}
`;

const InputSectionBlock = styled.div`
  ${stack({ gap: 8 })}
  padding: 14px 0;
  border-bottom: 1px solid ${colors.border.var};

  &:first-child {
    padding-top: 0;
  }

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const InputSectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const InputSectionContent = styled.div`
  font-size: 13px;
  color: ${colors.text.var};
`;

const FileRefList = styled.div`
  ${stack({ gap: 8 })}
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

type InputViewerProps = {
  value: unknown;
  sections?: CaseInputSection[];
  previewFooter?: ReactNode;
};

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

function FilePreview({
  entry,
  previewFooter,
}: {
  entry: FileEntry;
  previewFooter: ReactNode | undefined;
}) {
  const { key, file } = entry;
  const isImage = file.mimeType.startsWith('image/');
  const downloadName = file.name || `${key}.bin`;
  const fileUrl = getManualInputFileUrl(file);
  const { openImage, lightbox } = useImageLightbox({ footer: previewFooter });
  return (
    <FileCard>
      <FileHeader>
        <FileMeta>
          <FieldKey>{key}</FieldKey>
          <Tooltip content={file.name}>
            <FileName>{file.name || 'Pasted file'}</FileName>
          </Tooltip>
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

function InputSectionPreview({
  section,
  previewFooter,
}: {
  section: CaseInputSection;
  previewFooter: ReactNode | undefined;
}) {
  return (
    <InputSectionBlock>
      <InputSectionLabel>{section.label}</InputSectionLabel>
      <InputSectionContent>
        <InputSectionValue
          section={section}
          previewFooter={previewFooter}
        />
      </InputSectionContent>
    </InputSectionBlock>
  );
}

function InputSectionValue({
  section,
  previewFooter,
}: {
  section: CaseInputSection;
  previewFooter: ReactNode | undefined;
}) {
  if (isFileRefArray(section.value)) {
    return (
      <FileRefList>
        {section.value.map((fileRef, index) => (
          <FormattedCellValue
            key={getFileRefKey(fileRef, index)}
            def={section}
            value={fileRef}
            inferMarkdown
            markdownRawToggle
            previewFooter={previewFooter}
          />
        ))}
      </FileRefList>
    );
  }

  return (
    <FormattedCellValue
      def={section}
      value={section.value}
      inferMarkdown
      markdownRawToggle
      previewFooter={previewFooter}
    />
  );
}

function isFileRefArray(value: CellValue): value is FileRef[] {
  return Array.isArray(value) && value.every(isFileRef);
}

function isFileRef(value: unknown): value is FileRef {
  return fileRefSchema.safeParse(value).success;
}

function getFileRefKey(ref: FileRef, index: number): string {
  if (ref.source === 'run') return `${ref.artifactId}:${String(index)}`;
  return `${ref.path}:${String(index)}`;
}

/**
 * Render a case input. Top-level fields whose value is a manual-input file
 * (`{ name, mimeType, sizeBytes, sha256, path }`) are previewed as images or labelled
 * file cards with a download link; the remaining fields fall back to the
 * standard JSON viewer.
 */
export function InputViewer({
  value,
  sections = [],
  previewFooter,
}: InputViewerProps) {
  if (sections.length > 0) {
    return (
      <Layout>
        <InputSectionList>
          {sections.map((section) => (
            <InputSectionPreview
              key={section.key}
              section={section}
              previewFooter={previewFooter}
            />
          ))}
        </InputSectionList>
        <FileGroup>
          <GroupKicker>Full input</GroupKicker>
          <JsonViewer value={value} />
        </FileGroup>
      </Layout>
    );
  }

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
            previewFooter={previewFooter}
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
