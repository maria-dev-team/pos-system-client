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
import { LocalPosSyncProvider } from '../local-pos/local-pos-sync-provider';
import { LocalPosStatus } from './local-pos-status';

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  connect: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
const currentProfile = profileFixture();
vi.mock('@renderer/common/lib/local-pos', () => ({
  callLocalPos: mocks.call,
  connectLocalPos: mocks.connect,
  localPosActive: () => true,
  localPosProfile: () => currentProfile,
  subscribeLocalPosProfile: () => () => {},
}));
vi.mock('./local-conflict-dialog', () => ({ LocalConflictDialog: () => null }));
const makeStatus = (): PosStatus => ({
  sessionId: profileFixture().session.id,
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
    if (request.type === 'retry' || request.type === 'retrySale')
      return { ...state };
    if (request.type === 'archiveCancelledSale') {
      state.outbox = state.outbox?.filter(
        (item) => item.saleId !== request.saleId,
      );
      state.pending = state.outbox?.length ?? 0;
      return { ...state };
    }
    if (request.type === 'deferPayment')
      state.paymentReviews[0]!.deferred = true;
    return null;
  });
  render(
    <QueryClientProvider client={client}>
      <LocalPosSyncProvider enabled>
        <LocalPosStatus sessionId="cashier" />
      </LocalPosSyncProvider>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  window.localPos = { request: vi.fn(), onChange: () => () => {} };
  mocks.call.mockReset();
  mocks.connect.mockReset();
  Object.values(mocks.toast).forEach((mock) => mock.mockReset());
});
afterEach(() => {
  cleanup();
  delete window.localPos;
});

describe('checkout warnings and recovery actions', () => {
  it('requires confirmation before removing only the selected cancelled receipt', async () => {
    const state = makeStatus();
    const saleId = '77777777-7777-4777-8777-777777777777';
    state.pending = 2;
    state.outbox = [
      {
        saleId,
        saleStatus: 'CANCELLED',
        total: '1700.00',
        stage: 'draft',
        code: 'PRODUCT_NOT_FOUND',
        message: 'Товар недоступен',
        attempts: 1,
        nextAttemptAt: null,
        retryable: true,
        archivable: true,
      },
      {
        saleId: '88888888-8888-4888-8888-888888888888',
        saleStatus: 'DRAFT',
        total: '650.00',
        stage: 'draft',
        code: 'PRODUCT_NOT_FOUND',
        message: null,
        attempts: 1,
        nextAttemptAt: null,
        retryable: true,
        archivable: false,
      },
    ];
    mount(state);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Убрать из очереди',
        hidden: true,
      }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Убрать отменённый чек из очереди?' }),
    ).toBeTruthy();
    expect(
      mocks.call.mock.calls.some(([r]) => r.type === 'archiveCancelledSale'),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(
      mocks.call.mock.calls.some(([r]) => r.type === 'archiveCancelledSale'),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Убрать из очереди', hidden: true }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Подтвердить и убрать' }),
    );
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith({
        type: 'archiveCancelledSale',
        saleId,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(`ID чека: ${saleId}`)).toBeNull(),
    );
    expect(
      screen.getByText('ID чека: 88888888-8888-4888-8888-888888888888'),
    ).toBeTruthy();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Отменённый чек убран из очереди. Копия сохранена на кассе.',
    );
  });
  it('identifies a cancelled receipt and reports rejection or successful retry', async () => {
    const state = makeStatus();
    state.pending = 1;
    state.outbox = [
      {
        saleId: '77777777-7777-4777-8777-777777777777',
        saleStatus: 'CANCELLED',
        total: '1700.00',
        stage: 'draft',
        code: 'PRODUCT_NOT_FOUND',
        message: 'Товар не найден в каталоге магазина.',
        attempts: 1,
        nextAttemptAt: null,
        retryable: true,
      },
    ];
    mount(state);
    await screen.findByText(/Отмена чека/);
    expect(
      screen.getByText('ID чека: 77777777-7777-4777-8777-777777777777'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Повторить отправку чека',
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(mocks.toast.warning).toHaveBeenCalledWith(
        'Товар не найден в каталоге магазина.',
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', {
            name: 'Повторить отправку чека',
            hidden: true,
          })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
    state.pending = 0;
    state.outbox = [];
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Повторить отправку чека',
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Все изменения чеков отправлены.',
      ),
    );
  });
  it('explains a scheduled retry instead of silently reporting success', async () => {
    const state = makeStatus();
    state.pending = 1;
    state.outbox = [
      {
        saleId: '88888888-8888-4888-8888-888888888888',
        total: '1700.00',
        stage: 'draft',
        code: 'TOO_MANY_REQUESTS',
        message: 'Сервер занят.',
        attempts: 1,
        nextAttemptAt: Date.now() + 120000,
        retryable: true,
      },
    ];
    mount(state);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Повторить проверку' }),
    );
    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        expect.stringContaining('Следующая попытка отправки'),
      ),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
  it('does not reserve workspace space for a healthy background synchronization', async () => {
    const state = makeStatus();
    state.catalogReady = false;
    state.catalogSyncing = true;
    state.pending = 2;
    state.paymentPending = false;
    state.paymentReviews = [];
    state.fiscalShiftExpired = false;
    state.error = null;
    mount(state);
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith({ type: 'status' }),
    );
    expect(screen.queryByLabelText('Состояние кассы')).toBeNull();
  });

  it('shows an outbox rejection separately from payment review and retries only the selected receipt', async () => {
    const state = makeStatus();
    const saleId = '77777777-7777-4777-8777-777777777777';
    state.pending = 1;
    state.outbox = [
      {
        saleId,
        total: '650.00',
        stage: 'draft',
        code: 'PRODUCT_NOT_ACTIVE',
        message: 'Товар недоступен.',
        attempts: 1,
        nextAttemptAt: null,
        retryable: true,
      },
    ];
    mount(state);
    await screen.findByText('Очередь отправки: 1');
    expect(screen.getByText('Товар недоступен.')).toBeTruthy();
    expect(screen.queryByText(/PRODUCT_NOT_ACTIVE/)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Повторить отправку чека',
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith({ type: 'retrySale', saleId }),
    );
    expect(
      mocks.call.mock.calls.some(([request]) =>
        ['checkout', 'retry', 'reconcilePayment'].includes(request.type),
      ),
    ).toBe(false);
  });
  it('keeps next-receipt and retry actions available alongside independent warning paragraphs', async () => {
    mount(makeStatus());
    const button = await screen.findByRole('button', { name: 'Новый чек' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(
      screen.getByText(
        'Не удалось отправить некоторые чеки. Они сохранены на кассе.',
      ).tagName,
    ).toBe('P');
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

  it('offers explicit return to the receipt after a safe retry is confirmed', async () => {
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
