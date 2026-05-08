import { Store } from 't-state';
import type { TextViewMode } from '#src/components/TextViewModal';

export type JsonViewerCollapsed = boolean | number;

type BaseGlobalModal = { id: number };

export type TextViewGlobalModal = BaseGlobalModal & {
  kind: 'textView';
  title: string;
  subtitle: string | undefined;
  text: string;
  initialMode: TextViewMode | undefined;
};

export type JsonFullscreenGlobalModal = BaseGlobalModal & {
  kind: 'jsonFullscreen';
  value: unknown;
  collapsed: JsonViewerCollapsed;
  collapseStringsAfterLength: number;
  enableClipboard: boolean;
};

export type GlobalModal = TextViewGlobalModal | JsonFullscreenGlobalModal;

type ModalState = { modals: GlobalModal[] };

let nextModalId = 1;

export const modalStore = new Store<ModalState>({ state: { modals: [] } });

export function openTextViewModal({
  title,
  subtitle,
  text,
  initialMode,
}: {
  title: string;
  subtitle?: string | undefined;
  text: string;
  initialMode?: TextViewMode | undefined;
}): number {
  const id = nextModalId++;
  modalStore.setState((state) => ({
    ...state,
    modals: [
      ...state.modals,
      { id, kind: 'textView', title, subtitle, text, initialMode },
    ],
  }));
  return id;
}

export function openJsonFullscreenModal({
  value,
  collapsed,
  collapseStringsAfterLength,
  enableClipboard,
}: {
  value: unknown;
  collapsed: JsonViewerCollapsed;
  collapseStringsAfterLength: number;
  enableClipboard: boolean;
}): number {
  const id = nextModalId++;
  modalStore.setState((state) => ({
    ...state,
    modals: [
      ...state.modals,
      {
        id,
        kind: 'jsonFullscreen',
        value,
        collapsed,
        collapseStringsAfterLength,
        enableClipboard,
      },
    ],
  }));
  return id;
}

export function closeGlobalModal(id: number): void {
  modalStore.setState((state) => ({
    ...state,
    modals: state.modals.filter((modal) => modal.id !== id),
  }));
}
