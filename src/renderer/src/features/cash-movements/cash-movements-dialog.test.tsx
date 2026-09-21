import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createCashMovement, getCashMovements } from '@renderer/common/api';
import { callLocalPos } from '@renderer/common/lib/local-pos';

import { PosError } from '../../../../shared/pos/contracts';
import { profileFixture } from '../../../../shared/pos/test-fixtures';
import { cashMovementSchema } from './cash-movement.schema';
import { CashMovementsDialog } from './cash-movements-dialog';

vi.mock('@renderer/common/api', () => ({
  createCashMovement: vi.fn(),
  getCashMovements: vi.fn(),
}));
vi.mock('@renderer/common/lib/local-pos', () => ({
  localPosActive: () => true,
  callLocalPos: vi.fn(),
}));
const session = profileFixture().session;
const response = {
  balance: '5000.00',
  deposited: '0.00',
  withdrawn: '0.00',
  movements: [],
  meta: { total: 0, limit: 20, offset: 0, has_more: false },
};
function setup(type: 'DEPOSIT' | 'WITHDRAWAL' = 'DEPOSIT') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CashMovementsDialog
        session={session}
        initialType={type}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
async function fill() {
  await userEvent.type(screen.getByLabelText('Сумма, ₸'), '100,50');
  await userEvent.type(screen.getByLabelText('Причина'), 'Разменные деньги');
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(callLocalPos).mockResolvedValue(null);
  vi.mocked(getCashMovements).mockResolvedValue(response);
  vi.mocked(createCashMovement).mockImplementation(
    async (sessionId, command) => ({
      id: command.operationId,
      cashier_session_id: sessionId,
      organization_id: session.organization_id,
      store_id: session.store_id,
      register_id: session.register_id,
      register_shift_id: session.register_shift_id,
      membership_id: session.membership_id,
      type: command.type,
      amount: command.amount,
      reason: command.reason,
      created_at: new Date().toISOString(),
    }),
  );
});
afterEach(cleanup);

it.each(['DEPOSIT', 'WITHDRAWAL'] as const)(
  'submits %s only after explicit confirmation with amount, reason and stable ID',
  async (type) => {
    setup(type);
    expect(await screen.findByText('5 000,00 ₸')).toBeInTheDocument();
    await fill();
    expect(createCashMovement).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', {
        name: type === 'DEPOSIT' ? 'Внести деньги' : 'Изъять деньги',
      }),
    );
    expect(
      await screen.findByText(
        type === 'DEPOSIT' ? 'Внесение выполнено' : 'Изъятие выполнено',
      ),
    ).toBeInTheDocument();
    expect(createCashMovement).toHaveBeenCalledExactlyOnceWith(session.id, {
      operationId: expect.any(String),
      type,
      amount: '100.50',
      reason: 'Разменные деньги',
    });
    expect(callLocalPos).toHaveBeenCalledWith({ type: 'prepareCashMovement' });
    expect(
      localStorage.getItem(`maria-pos-cash-movement:${session.id}`),
    ).toBeNull();
  },
);
it('restores an uncertain operation after remount and retries the identical command', async () => {
  vi.mocked(createCashMovement).mockRejectedValueOnce(
    new Error('Connection lost'),
  );
  setup();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Внести деньги' }));
  await screen.findByRole('alert');
  const command = vi.mocked(createCashMovement).mock.calls[0]![1];
  cleanup();
  setup('WITHDRAWAL');
  expect(screen.getByLabelText('Сумма, ₸')).toHaveValue('100.50');
  expect(screen.getByLabelText('Причина')).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Повторить проверку операции' }),
  );
  await screen.findByText('Внесение выполнено');
  expect(createCashMovement).toHaveBeenNthCalledWith(2, session.id, command);
});
it('does not send money commands if local synchronization fails', async () => {
  setup();
  await screen.findByText('5 000,00 ₸');
  await fill();
  vi.mocked(callLocalPos).mockRejectedValue(new Error('Pending payment'));
  await userEvent.click(screen.getByRole('button', { name: 'Внести деньги' }));
  await screen.findByRole('alert');
  expect(createCashMovement).not.toHaveBeenCalled();
  expect(
    localStorage.getItem(`maria-pos-cash-movement:${session.id}`),
  ).toBeNull();
  expect(screen.getByLabelText('Сумма, ₸')).toBeEnabled();
  expect(
    screen.queryByText(/Сохранена неподтверждённая операция/),
  ).not.toBeInTheDocument();
});
it('does not lose the command if the server returns a mismatching acknowledgement', async () => {
  vi.mocked(createCashMovement).mockResolvedValue({ id: 'wrong' } as never);
  setup();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Внести деньги' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Сервер не подтвердил операцию',
  );
  expect(
    localStorage.getItem(`maria-pos-cash-movement:${session.id}`),
  ).not.toBeNull();
});
it('prevents duplicate submissions while a command is pending', async () => {
  vi.mocked(createCashMovement).mockImplementation(() => new Promise(() => {}));
  setup();
  await fill();
  const button = screen.getByRole('button', { name: 'Внести деньги' });
  await userEvent.dblClick(button);
  await waitFor(() => expect(createCashMovement).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Сумма, ₸')).toBeDisabled();
});
it.each(['0', '-10', '12.345', '10000000000000000', '1e2', 'NaN'])(
  'rejects invalid amount %s',
  (amount) => {
    expect(
      cashMovementSchema.safeParse({
        type: 'DEPOSIT',
        amount,
        reason: 'Размен',
      }).success,
    ).toBe(false);
  },
);

it('loads balance and retries an already saved command with the previous Electron IPC schema', async () => {
  const command = {
    operationId: crypto.randomUUID(),
    type: 'DEPOSIT',
    amount: '100.50',
    reason: 'Разменные деньги',
  };
  localStorage.setItem(
    `maria-pos-cash-movement:${session.id}`,
    JSON.stringify(command),
  );
  vi.mocked(callLocalPos).mockImplementation(async (request) => {
    if (request.type === 'prepareCashMovement')
      throw new PosError('INVALID_REQUEST', 'Некорректные параметры операции.');
    if (request.type === 'flush') return null;
    throw new Error('Unexpected IPC request');
  });
  setup();
  expect(await screen.findByText('5 000,00 ₸')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Повторить проверку операции' }),
  );
  await screen.findByText('Внесение выполнено');
  expect(callLocalPos).toHaveBeenCalledWith({ type: 'flush' });
  expect(createCashMovement).toHaveBeenCalledExactlyOnceWith(
    session.id,
    command,
  );
  expect(
    localStorage.getItem(`maria-pos-cash-movement:${session.id}`),
  ).toBeNull();
});
it('does not bypass the previous Electron synchronization guard', async () => {
  setup();
  await screen.findByText('5 000,00 ₸');
  await fill();
  vi.mocked(callLocalPos).mockImplementation(async (request) => {
    throw new PosError(
      request.type === 'prepareCashMovement'
        ? 'INVALID_REQUEST'
        : 'SYNC_REQUIRED',
      'Сначала синхронизируйте чеки.',
    );
  });
  await userEvent.click(screen.getByRole('button', { name: 'Внести деньги' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Сначала синхронизируйте чеки.',
  );
  expect(createCashMovement).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Сумма, ₸')).toBeEnabled();
  expect(
    localStorage.getItem(`maria-pos-cash-movement:${session.id}`),
  ).toBeNull();
});
it('preserves a previously sent command when preparation fails on retry', async () => {
  const command = {
    operationId: crypto.randomUUID(),
    type: 'WITHDRAWAL',
    amount: '100.50',
    reason: 'Инкассация',
  };
  localStorage.setItem(
    `maria-pos-cash-movement:${session.id}`,
    JSON.stringify(command),
  );
  setup();
  await screen.findByText('5 000,00 ₸');
  vi.mocked(callLocalPos).mockRejectedValue(
    new PosError('SYNC_REQUIRED', 'Сначала синхронизируйте чеки.'),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Повторить проверку операции' }),
  );
  await screen.findByRole('alert');
  expect(callLocalPos).not.toHaveBeenCalledWith({ type: 'flush' });
  expect(createCashMovement).not.toHaveBeenCalled();
  expect(
    JSON.parse(localStorage.getItem(`maria-pos-cash-movement:${session.id}`)!),
  ).toEqual(command);
  expect(screen.getByLabelText('Сумма, ₸')).toBeDisabled();
});
it('never sends a command when saving its recovery data fails', async () => {
  setup();
  await screen.findByText('5 000,00 ₸');
  await fill();
  const storage = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
  try {
    await userEvent.click(
      screen.getByRole('button', { name: 'Внести деньги' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Запрос на сервер не отправлен.',
    );
    expect(createCashMovement).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Сумма, ₸')).toBeEnabled();
  } finally {
    storage.mockRestore();
  }
});
