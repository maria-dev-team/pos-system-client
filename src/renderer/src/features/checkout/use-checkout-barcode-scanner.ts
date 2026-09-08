import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

import { BarcodeScannerBuffer } from './barcode-scanner-buffer';

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]';
const OVERLAY =
  'dialog[open], [role="dialog"]:not([hidden]):not([data-state="closed"]), [role="alertdialog"]:not([hidden]):not([data-state="closed"]), [aria-modal="true"], [role="menu"], [role="listbox"]';

function workspaceAcceptsKeys(
  workspace: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (
    !workspace.isConnected ||
    document.hidden ||
    document.querySelector(OVERLAY)
  )
    return false;
  if (
    (target instanceof Element && target.closest(EDITABLE)) ||
    document.activeElement?.closest(EDITABLE)
  )
    return false;
  return (
    target === document ||
    target === document.body ||
    target === document.documentElement ||
    (target instanceof Node && workspace.contains(target))
  );
}

/** Restore checkout navigation without opening a text keyboard or stealing a dialog's focus. */
export function focusCheckoutWorkspace(workspace: HTMLElement | null): void {
  if (workspace && workspaceAcceptsKeys(workspace, document.activeElement))
    workspace.focus({ preventScroll: true });
}

export function useCheckoutBarcodeScanner({
  enabled,
  workspaceRef,
  onScan,
}: {
  enabled: boolean;
  workspaceRef: RefObject<HTMLElement | null>;
  onScan: (barcode: string) => void;
}): void {
  const callback = useRef(onScan);
  const scanner = useRef(new BarcodeScannerBuffer());
  useLayoutEffect(() => {
    callback.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    const buffer = scanner.current;
    const reset = () => buffer.interrupt();
    const keydown = (event: KeyboardEvent) => {
      const workspace = workspaceRef.current;
      if (
        !workspace ||
        !workspaceAcceptsKeys(workspace, event.target) ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat
      ) {
        reset();
        return;
      }
      const groupSeparator =
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key === ']' &&
        buffer.isCandidate;
      if (
        (event.ctrlKey && event.key !== 'Control' && !groupSeparator) ||
        event.altKey ||
        event.metaKey
      ) {
        reset();
        return;
      }
      const barcode = buffer.accept(
        groupSeparator ? '\x1d' : event.key,
        event.timeStamp,
      );
      if (barcode) {
        // Capture the scanner terminator before it can activate the focused
        // Pay/Cancel button or move focus. Unmatched Enter/Tab behave normally.
        event.preventDefault();
        event.stopImmediatePropagation();
        callback.current(barcode);
      } else if (groupSeparator || (event.key === ' ' && buffer.isCandidate)) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', reset, true);
    document.addEventListener('pointerdown', reset, true);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', reset, true);
      document.removeEventListener('pointerdown', reset, true);
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('blur', reset);
    };
  }, [enabled, workspaceRef]);
}
