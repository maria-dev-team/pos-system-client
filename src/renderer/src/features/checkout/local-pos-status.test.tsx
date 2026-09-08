import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosRequest, PosStatus } from '../../../../shared/pos/contracts';
import { profileFixture } from '../../../../shared/pos/test-fixtures';
import { LocalPosStatus } from './local-pos-status';

const mocks = vi.hoisted(() => ({ call: vi.fn(), connect: vi.fn() }));
vi.mock('@renderer/common/lib/local-pos', () => ({
  callLocalPos: mocks.call,
  connectLocalPos: mocks.connect,
  localPosActive: () => true,
  localPosProfile: () => profileFixture(),
}));
vi.mock('./local-conflict-dialog', () => ({ LocalConflictDialog: () => null }));
const makeStatus = (): PosStatus => ({
  connected: true,
  catalogReady: true,
  catalogUpdatedAt: null,
  conflicts: [],
  pending: 0,
  paymentPending: true,
  authorizationRequired: false,
  tokenRefreshRequired: false,
  fiscalShiftExpired: true,
  error: 'Предупреждение',
  paymentReviews: [
    {
      saleId: 'receipt-id',
      total: '650.00',
      deferred: false,
      canResume: false,
    },
  ],
});
function mount(state: PosStatus): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.call.mockImplementation(async (request: PosRequest) => {
    if (request.type === 'status') return { ...state };
    if (request.type === 'deferPayment')
      state.paymentReviews[0]!.deferred = true;
    return null;
  });
  render(
    <QueryClientProvider client={client}>
      <LocalPosStatus sessionId="cashier" />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  mocks.call.mockReset();
  mocks.connect.mockReset();
});
afterEach(cleanup);

describe('checkout warnings and recovery actions', () => {
  it('keeps next-receipt and retry actions available alongside independent warning paragraphs', async () => {
    mount(makeStatus());
    const button = await screen.findByRole('button', { name: 'Новый чек' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Предупреждение').tagName).toBe('P');
    expect(
      screen.getByText(/Смена кассы открыта больше 24 часов/).tagName,
    ).toBe('P');
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith({
        type: 'deferPayment',
        saleId: 'receipt-id',
      }),
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Новый чек' })).toBeNull(),
    );
    expect(
      screen
        .getByRole('button', { name: 'Проверить оплату' })
        .hasAttribute('disabled'),
    ).toBe(false);
  });

  it('automatically renews expired credentials once without disabling the workspace action', async () => {
    const state = makeStatus();
    state.tokenRefreshRequired = true;
    state.authorizationRequired = true;
    mocks.connect.mockImplementation(async () => {
      state.tokenRefreshRequired = false;
      state.authorizationRequired = false;
      return profileFixture();
    });
    mount(state);
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    expect(mocks.connect).toHaveBeenCalledWith(
      profileFixture().session.register_id,
      true,
    );
    expect(
      (await screen.findByRole('button', { name: 'Новый чек' })).hasAttribute(
        'disabled',
      ),
    ).toBe(false);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Повторить проверку' })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
  });

  it('offers explicit return to the receipt after the backend confirms a safe retry', async () => {
    const state = makeStatus();
    state.paymentPending = false;
    state.paymentReviews[0] = {
      ...state.paymentReviews[0]!,
      deferred: true,
      canResume: true,
    };
    mount(state);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Вернуться к чеку' }),
    );
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith({
        type: 'resumePayment',
        saleId: 'receipt-id',
      }),
    );
  });
});
