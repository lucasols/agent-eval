import { Check, Code2, Copy, Eye } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { Modal } from '#src/components/Modal';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, transition } from '#src/style/helpers';
import { copyTextToClipboard } from '#src/utils/clipboard';

type TextViewMode = 'plain' | 'markdown';

const Body = styled.div`
  ${stack({ gap: 12 })}
  min-width: min(760px, calc(100vw - 72px));
`;

const Toolbar = styled.div`
  ${inline({ justify: 'right', align: 'center' })}
`;

const ModeToggle = styled.div`
  ${inline()}
  padding: 1px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
`;

const ModeButton = styled.button<{ active: boolean }>`
  ${inline({ align: 'center', gap: 5 })}
  ${transition({ property: 'background, color' })}
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: ${colors.textMuted.var};
  font-size: 11px;
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
    width: 12px;
    height: 12px;
  }
`;

const PlainText = styled.pre`
  ${monoFont};
  margin: 0;
  max-height: min(68vh, 720px);
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`;

const MarkdownText = styled.div`
  max-height: min(68vh, 720px);
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  font-size: 12.5px;
  line-height: 1.55;

  & * {
    font-size: inherit;
    line-height: inherit;
  }

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
    margin: 0 0 8px;
  }

  & p {
    margin: 0 0 8px;
  }

  & ul,
  & ol {
    margin: 0 0 8px;
    padding-left: 18px;
  }

  & li {
    margin: 0 0 3px;
    padding-left: 2px;
  }

  & li:last-child {
    margin-bottom: 0;
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
    font-size: 17px;
  }

  & h2 {
    font-size: 15px;
  }

  & h3 {
    font-size: 13.5px;
  }

  & code {
    ${monoFont};
    background: ${colors.surface.var};
    border: 1px solid ${colors.border.var};
    border-radius: var(--radius-sm);
    padding: 1px 4px;
    font-size: 0.92em;
  }

  & pre {
    ${monoFont};
    overflow: auto;
    padding: 10px;
    background: ${colors.surface.var};
    border: 1px solid ${colors.border.var};
    border-radius: var(--radius-sm);
  }

  & pre code {
    background: transparent;
    border: none;
    padding: 0;
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

/**
 * Generic modal for inspecting long text values. It can render the same text
 * as plain preformatted content or as GitHub-flavored Markdown.
 */
export function TextViewModal({
  isOpen,
  title,
  subtitle,
  text,
  initialMode = 'plain',
  onClose,
}: {
  isOpen: boolean;
  title: string;
  subtitle?: string | undefined;
  text: string;
  initialMode?: TextViewMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<TextViewMode>(initialMode);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyTextToClipboard(text, 'Copy text');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      wide
      topLayer
      headerActions={
        <Button
          variant="secondary"
          leftIcon={copied ? <Check /> : <Copy />}
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      }
      footer={
        <>
          <span />
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Close
          </Button>
        </>
      }
    >
      <Body>
        <Toolbar>
          <ModeToggle>
            <ModeButton
              type="button"
              active={mode === 'plain'}
              aria-pressed={mode === 'plain'}
              onClick={() => setMode('plain')}
            >
              <Code2 />
              Plain
            </ModeButton>
            <ModeButton
              type="button"
              active={mode === 'markdown'}
              aria-pressed={mode === 'markdown'}
              onClick={() => setMode('markdown')}
            >
              <Eye />
              Markdown
            </ModeButton>
          </ModeToggle>
        </Toolbar>

        {mode === 'markdown' ? (
          <MarkdownText>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </MarkdownText>
        ) : (
          <PlainText>{text}</PlainText>
        )}
      </Body>
    </Modal>
  );
}
