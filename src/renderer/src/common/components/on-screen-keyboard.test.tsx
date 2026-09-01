import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnScreenKeyboardProvider } from './on-screen-keyboard';

afterEach(cleanup);

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

    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

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
