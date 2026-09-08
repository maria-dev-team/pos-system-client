import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  focusCheckoutWorkspace,
  useCheckoutBarcodeScanner,
} from './use-checkout-barcode-scanner';

let at = 1000;
function key(
  target: Element | Document,
  value: string,
  options: KeyboardEventInit = {},
): Event {
  const event = createEvent.keyDown(target, {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  Object.defineProperty(event, 'timeStamp', { value: (at += 8) });
  fireEvent(target, event);
  return event;
}
function scan(
  target: Element | Document,
  value = '001234',
  suffix = 'Enter',
): Event {
  [...value].forEach((value) => key(target, value));
  return key(target, suffix);
}
function Harness({
  enabled = true,
  modal = false,
  onScan,
  onEnter = () => undefined,
}: {
  enabled?: boolean;
  modal?: boolean;
  onScan: (code: string) => void;
  onEnter?: () => void;
}) {
  const workspaceRef = useRef<HTMLElement>(null);
  useCheckoutBarcodeScanner({ enabled, workspaceRef, onScan });
  return (
    <>
      <main aria-label="Касса" ref={workspaceRef} tabIndex={-1}>
        <input aria-label="Поиск" />
        <textarea aria-label="Комментарий" />
        <div
          role="textbox"
          aria-label="Редактор"
          contentEditable
          suppressContentEditableWarning
        >
          <span>Текст</span>
        </div>
        <button
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEnter();
          }}
        >
          Оплата
        </button>
      </main>
      <button>Другая область</button>
      {modal ? (
        <div role="dialog" aria-label="Ввод суммы">
          <input aria-label="Сумма" />
        </div>
      ) : null}
    </>
  );
}
beforeEach(() => {
  at = 1000;
});
afterEach(cleanup);

describe('checkout-only unfocused scanner', () => {
  it('accepts scans on the workspace/body without focusing the search input', () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    scan(document.body);
    scan(screen.getByRole('main'), '009876', 'Tab');
    expect(onScan.mock.calls).toEqual([['001234'], ['009876']]);
    expect(screen.getByLabelText('Поиск')).not.toHaveFocus();
    expect(screen.getByLabelText('Поиск')).toHaveValue('');
  });
  it('consumes the scanner terminator instead of activating a focused button', () => {
    const onScan = vi.fn(),
      onEnter = vi.fn();
    render(<Harness onScan={onScan} onEnter={onEnter} />);
    const button = screen.getByRole('button', { name: 'Оплата' });
    button.focus();
    expect(scan(button).defaultPrevented).toBe(true);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    expect(key(button, 'Enter').defaultPrevented).toBe(false);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(key(button, 'Tab').defaultPrevented).toBe(false);
  });
  it.each(['Поиск', 'Комментарий', 'Редактор'])(
    'does not intercept fast typing in %s',
    (name) => {
      const onScan = vi.fn();
      render(<Harness onScan={onScan} />);
      const field = screen.getByLabelText(name);
      field.focus();
      expect(scan(field).defaultPrevented).toBe(false);
      expect(onScan).not.toHaveBeenCalled();
    },
  );
  it('does not scan over a modal or from another screen region', () => {
    const onScan = vi.fn();
    const { rerender } = render(<Harness onScan={onScan} modal />);
    scan(document.body);
    scan(screen.getByLabelText('Сумма'));
    expect(onScan).not.toHaveBeenCalled();
    rerender(<Harness onScan={onScan} />);
    scan(screen.getByRole('button', { name: 'Другая область' }));
    expect(onScan).not.toHaveBeenCalled();
    scan(document.body);
    expect(onScan).toHaveBeenCalledWith('001234');
  });
  it('preserves GS1 group separators emitted as Ctrl+] without treating shortcuts as scans', () => {
    const onScan = vi.fn();
    render(<Harness onScan={onScan} />);
    [...']d2010487000000001221ABC'].forEach((value) =>
      key(document.body, value),
    );
    key(document.body, 'Control', { ctrlKey: true });
    expect(key(document.body, ']', { ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    [...'91XYZ'].forEach((value) => key(document.body, value));
    key(document.body, 'Enter');
    expect(onScan).toHaveBeenCalledWith(']d2010487000000001221ABC\x1d91XYZ');
    key(document.body, 'k', { ctrlKey: true });
    key(document.body, 'Enter');
    expect(onScan).toHaveBeenCalledTimes(1);
  });
  it('discards partial codes on blur, pointer interaction and temporary disablement', () => {
    const onScan = vi.fn();
    const { rerender } = render(<Harness onScan={onScan} />);
    key(document.body, '9');
    fireEvent.blur(window);
    scan(document.body);
    key(document.body, '9');
    fireEvent.pointerDown(document.body);
    scan(document.body);
    key(document.body, '9');
    rerender(<Harness onScan={onScan} enabled={false} />);
    rerender(<Harness onScan={onScan} />);
    scan(document.body);
    expect(onScan).not.toHaveBeenCalled();
    scan(document.body);
    expect(onScan).toHaveBeenCalledTimes(1);
  });
  it('keeps the frame across rerenders but uses the newest callback and cleans up on unmount', () => {
    const first = vi.fn(),
      second = vi.fn();
    const { rerender, unmount } = render(<Harness onScan={first} />);
    key(document.body, '0');
    rerender(<Harness onScan={second} />);
    scan(document.body, '01234');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('001234');
    unmount();
    scan(document.body);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('restores workspace focus but never steals a text field or modal focus', () => {
    const { rerender } = render(<Harness onScan={vi.fn()} />);
    const workspace = screen.getByRole('main');
    focusCheckoutWorkspace(workspace);
    expect(workspace).toHaveFocus();
    const field = screen.getByLabelText('Поиск');
    field.focus();
    focusCheckoutWorkspace(workspace);
    expect(field).toHaveFocus();
    rerender(<Harness onScan={vi.fn()} modal />);
    const amount = screen.getByLabelText('Сумма');
    amount.focus();
    focusCheckoutWorkspace(workspace);
    expect(amount).toHaveFocus();
  });
});
