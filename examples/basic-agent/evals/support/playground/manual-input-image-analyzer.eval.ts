import {
  defineEval,
  manualInputFileValueSchema,
  readManualInputFile,
  z,
  type ManualInputFileValue,
} from '@ls-stack/agent-eval';

const manualInputImageAnalyzerInputSchema = z.object({
  image: manualInputFileValueSchema.describe(
    'Click to upload, drop, or paste an image into the modal.',
  ),
  caption: z
    .string()
    .max(120)
    .optional()
    .describe('Optional caption to include in the agent reply.'),
});
type ManualInputImageAnalyzerInput = z.infer<
  typeof manualInputImageAnalyzerInputSchema
>;

const manualInputImageAnalyzerOutputsSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  isImage: z.boolean(),
  byteHead: z.string(),
  reply: z.string(),
});
type ManualInputImageAnalyzerOutputs = z.infer<
  typeof manualInputImageAnalyzerOutputsSchema
>;

function previewBytes(bytes: Uint8Array, count: number): string {
  const slice = bytes.slice(0, count);
  return Array.from(slice)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
}

defineEval<ManualInputImageAnalyzerInput, ManualInputImageAnalyzerOutputs>({
  id: 'manual-input-image-analyzer',
  title: 'Manual Input Image Analyzer',
  manualInput: {
    schema: manualInputImageAnalyzerInputSchema,
    title: 'Analyze an image',
    description:
      'Pick an image from disk, drop one onto the dropzone, or paste from your clipboard. The agent reports basic facts about the file.',
    submitLabel: 'Analyze',
    fields: {
      image: {
        asFile: true,
        accept: 'image/*',
        maxSizeBytes: 5 * 1024 * 1024,
        label: 'Image',
        description: 'PNG, JPEG, or any other image format up to 5 MB.',
      },
      caption: {
        label: 'Caption',
        placeholder: 'Optional caption shown in the reply',
      },
    },
  },
  outputsSchema: manualInputImageAnalyzerOutputsSchema,
  async execute({ input, setOutput }) {
    const file: ManualInputFileValue = input.image;
    const uploaded = await readManualInputFile(file);
    const bytes = uploaded.bytes;
    const isImage = file.mimeType.startsWith('image/');
    const captionFragment =
      input.caption && input.caption.trim().length > 0
        ? ` — caption: "${input.caption.trim()}"`
        : '';
    const reply = isImage
      ? `Got "${file.name}" (${file.mimeType}, ${file.sizeBytes} bytes)${captionFragment}.`
      : `Received "${file.name}" but it does not look like an image (${file.mimeType || 'unknown type'}).`;
    setOutput('fileName', file.name);
    setOutput('mimeType', file.mimeType);
    setOutput('sizeBytes', file.sizeBytes);
    setOutput('isImage', isImage);
    setOutput('byteHead', previewBytes(bytes, 8));
    setOutput('reply', reply);
  },
});
