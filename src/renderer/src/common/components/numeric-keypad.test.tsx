import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { NumericKeypad } from './numeric-keypad';

afterEach(cleanup);

function KeypadHarness() {
  const [value, setValue] = useState('');

  return (
    <>
      <output aria-label="Значение">{value}</output>
      <NumericKeypad onValueChange={setValue} value={value} />
    </>
  );
}

describe('NumericKeypad', () => {
  it('builds a decimal value and ignores a second decimal separator', async () => {
    const user = userEvent.setup();
    render(<KeypadHarness />);

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Десятичная точка' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Десятичная точка' }));

    expect(screen.getByRole('status', { name: 'Значение' })).toHaveTextContent(
      '12.5',
    );
  });

  it('removes the last symbol and clears the value', async () => {
    const user = userEvent.setup();
    render(<KeypadHarness />);

    await user.click(screen.getByRole('button', { name: '00' }));
    await user.click(screen.getByRole('button', { name: '7' }));
    await user.click(
      screen.getByRole('button', { name: 'Удалить последний символ' }),
    );
    expect(screen.getByRole('status', { name: 'Значение' })).toHaveTextContent(
      '00',
    );

    await user.click(screen.getByRole('button', { name: 'Очистить' }));
    expect(
      screen.getByRole('status', { name: 'Значение' }),
    ).toBeEmptyDOMElement();
  });
});
