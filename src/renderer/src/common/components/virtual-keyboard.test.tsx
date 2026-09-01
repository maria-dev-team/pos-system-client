import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VirtualKeyboard } from './virtual-keyboard';

afterEach(cleanup);

function KeyboardHarness({ maxLength }: { maxLength?: number }) {
  const [value, setValue] = useState('');

  return (
    <>
      <input aria-label="Поиск" value={value} onChange={() => undefined} />
      <output aria-label="Значение">{value}</output>
      <VirtualKeyboard
        maxLength={maxLength}
        onValueChange={setValue}
        value={value}
      />
    </>
  );
}

describe('VirtualKeyboard', () => {
  it('renders physical Russian rows', () => {
    const onClose = vi.fn();
    const { container } = render(
      <VirtualKeyboard
        onClose={onClose}
        onValueChange={() => undefined}
        value=""
      />,
    );
    const rows = () =>
      Array.from(container.querySelectorAll<HTMLElement>('.hg-row')).map(
        (row) =>
          Array.from(
            row.querySelectorAll<HTMLElement>('[data-skbtn]'),
            (button) => button.dataset.skbtn,
          ),
      );

    expect(rows()).toEqual([
      ['ё', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '{bksp}'],
      ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
      ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
      ['{shift}', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '.', ','],
      ['{lang}', '@', '-', '_', '{space}', '{enter}', '{clear}', '{close}'],
    ]);
  });

  it('switches between Russian and English layouts', async () => {
    const user = userEvent.setup();
    render(<KeyboardHarness />);

    await user.click(
      screen.getByRole('button', { name: 'Переключить на английский' }),
    );
    await user.click(screen.getByRole('button', { name: 'q' }));

    expect(screen.getByRole('status', { name: 'Значение' })).toHaveTextContent(
      'q',
    );
    expect(
      screen.getByRole('button', { name: 'Переключить на русский' }),
    ).toBeInTheDocument();
  });

  it('appends Russian letters, digits, and spaces without moving input focus', async () => {
    const user = userEvent.setup();
    render(<KeyboardHarness />);

    const input = screen.getByRole('textbox', { name: 'Поиск' });
    await user.click(input);
    await user.click(screen.getByRole('button', { name: 'п' }));
    await user.click(screen.getByRole('button', { name: 'ё' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Пробел' }));

    expect(screen.getByRole('status', { name: 'Значение' }).textContent).toBe(
      'пё5 ',
    );
    expect(input).toHaveFocus();
  });

  it('removes, clears, limits, closes, and disables keyboard input', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <KeyboardHarness maxLength={2} />
        <VirtualKeyboard disabled onValueChange={() => undefined} value="" />
        <VirtualKeyboard
          onClose={onClose}
          onValueChange={() => undefined}
          value=""
        />
      </>,
    );

    await user.click(screen.getAllByRole('button', { name: 'а' })[0]!);
    await user.click(screen.getAllByRole('button', { name: 'б' })[0]!);
    await user.click(screen.getAllByRole('button', { name: 'в' })[0]!);
    expect(screen.getByRole('status', { name: 'Значение' })).toHaveTextContent(
      'аб',
    );

    await user.click(
      screen.getAllByRole('button', { name: 'Удалить последний символ' })[0]!,
    );
    expect(screen.getByRole('status', { name: 'Значение' })).toHaveTextContent(
      'а',
    );
    await user.click(screen.getAllByRole('button', { name: 'Очистить' })[0]!);
    expect(
      screen.getByRole('status', { name: 'Значение' }),
    ).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button', { name: 'а' })[1]).toBeDisabled();
  });
});
