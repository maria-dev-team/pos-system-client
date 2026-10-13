import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnScreenKeyboardProvider } from './on-screen-keyboard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness() {
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');

  return (
    <OnScreenKeyboardProvider>
      <input
        aria-label="Название"
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <input
        aria-label="Сумма"
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
        value={amount}
      />
    </OnScreenKeyboardProvider>
  );
}

describe('OnScreenKeyboardProvider', () => {
  it('opens for a focused text field', () => {
    render(
      <OnScreenKeyboardProvider>
        <input aria-label="Поиск товара" autoFocus />
      </OnScreenKeyboardProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Поиск товара' })).toHaveFocus();
    expect(
      screen.getByRole('dialog', { name: 'Экранная клавиатура' }),
    ).toBeInTheDocument();
  });

  it('opens the numeric overlay for numeric fields', () => {
    render(
      <OnScreenKeyboardProvider>
        <input aria-label="Наличные в кассе" autoFocus inputMode="decimal" />
      </OnScreenKeyboardProvider>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Экранная цифровая клавиатура' }),
    ).toBeInTheDocument();
  });

  it('does not duplicate a keypad that is already embedded in the form', () => {
    render(
      <OnScreenKeyboardProvider>
        <input
          aria-label="Наличные в кассе"
          autoFocus
          data-keyboard-inline
          inputMode="decimal"
        />
      </OnScreenKeyboardProvider>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders as a viewport overlay outside the page layout', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <OnScreenKeyboardProvider>
        <input aria-label="Комментарий" />
      </OnScreenKeyboardProvider>,
    );

    await user.click(screen.getByRole('textbox', { name: 'Комментарий' }));

    expect(
      container.querySelector('[data-on-screen-keyboard]'),
    ).not.toBeInTheDocument();
    expect(
      document.body.querySelector('[data-on-screen-keyboard]'),
    ).toHaveClass('fixed');
  });

  it('closes after one press outside and preserves the outside action', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <OnScreenKeyboardProvider>
        <input aria-label="Комментарий" />
        <button onClick={onContinue} type="button">
          Продолжить
        </button>
      </OnScreenKeyboardProvider>,
    );

    await user.click(screen.getByRole('textbox', { name: 'Комментарий' }));
    expect(
      screen.getByRole('dialog', { name: 'Экранная клавиатура' }),
    ).toBeInTheDocument();

    await user.pointer({
      target: screen.getByRole('button', { name: 'Продолжить' }),
      keys: '[MouseLeft>]',
    });
    // The layout must not move the pressed button before the click completes.
    expect(
      screen.getByRole('dialog', { name: 'Экранная клавиатура' }),
    ).toBeInTheDocument();
    await user.pointer({ keys: '[/MouseLeft]' });

    expect(onContinue).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('dialog', { name: 'Экранная клавиатура' }),
    ).not.toBeInTheDocument();
  });

  it('opens the symbol keyboard on text field press and edits controlled values', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const text = screen.getByRole('textbox', { name: 'Название' });
    await user.click(text);
    expect(
      screen.getByRole('dialog', { name: 'Экранная клавиатура' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Переключить на английский' }),
    );
    await user.click(screen.getByRole('button', { name: 'q' }));
    expect(text).toHaveValue('q');
    expect(
      screen.getByRole('dialog', { name: 'Экранная клавиатура' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Закрыть экранную клавиатуру' }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Экранная клавиатура' }),
    ).not.toBeInTheDocument();
    expect(text).toHaveFocus();

    const amount = screen.getByRole('textbox', { name: 'Сумма' });
    await user.click(amount);
    expect(
      screen.getByRole('dialog', { name: 'Экранная цифровая клавиатура' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(amount).toHaveValue('1');
  });

  it('measures the keyboard, reveals focused fields, handles resize, and restores the viewport', async () => {
    const user = userEvent.setup();
    let keyboardTop = 420;
    let resizeKeyboard = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeKeyboard = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute('data-on-screen-keyboard'))
          return new DOMRect(0, keyboardTop, 1024, 340);
        if (this instanceof HTMLInputElement)
          return new DOMRect(100, 500, 300, 48);
        return originalBounds.call(this);
      },
    );
    const { unmount } = render(
      <OnScreenKeyboardProvider>
        <input aria-label="Первое поле" />
        <input aria-label="Второе поле" />
      </OnScreenKeyboardProvider>,
    );
    const first = screen.getByRole('textbox', { name: 'Первое поле' });
    const second = screen.getByRole('textbox', { name: 'Второе поле' });
    const scrollFirst = vi.fn(),
      scrollSecond = vi.fn();
    Object.defineProperty(first, 'scrollIntoView', { value: scrollFirst });
    Object.defineProperty(second, 'scrollIntoView', { value: scrollSecond });
    await user.click(first);
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('420px');
    await waitFor(() => expect(scrollFirst).toHaveBeenCalled());
    await user.click(second);
    await waitFor(() => expect(scrollSecond).toHaveBeenCalled());
    keyboardTop = 360;
    act(() => resizeKeyboard());
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('360px');
    keyboardTop = 300;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('300px');
    await user.click(
      screen.getByRole('button', { name: 'Закрыть экранную клавиатуру' }),
    );
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('');
    expect(disconnect).toHaveBeenCalled();
    await user.click(first);
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('300px');
    unmount();
    expect(
      document.documentElement.style.getPropertyValue('--pos-viewport-height'),
    ).toBe('');
    expect(document.body.dataset.onScreenKeyboardOpen).toBeUndefined();
  });

  it('sends Enter to the focused field and closes with one action', async () => {
    const onKeyDown = vi.fn((event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.preventDefault();
    });
    const user = userEvent.setup();
    render(
      <OnScreenKeyboardProvider>
        <input aria-label="Количество" onKeyDown={onKeyDown} />
      </OnScreenKeyboardProvider>,
    );

    await user.click(screen.getByRole('textbox', { name: 'Количество' }));
    await user.click(screen.getByRole('button', { name: 'Ввод' }));

    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('Enter');
    expect(
      screen.queryByRole('dialog', { name: 'Экранная клавиатура' }),
    ).not.toBeInTheDocument();
  });
});
