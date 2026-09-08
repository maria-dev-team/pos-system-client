import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { queryKeys } from '@renderer/common/constants';

import type { PosStatus, SaleResponse } from '../../../../shared/pos/contracts';
import { ids, profileFixture } from '../../../../shared/pos/test-fixtures';
import { LocalPosSyncBar } from './local-pos-sync-bar';
import { localPosStatusKey } from './local-pos-sync-context';
import { LocalPosSyncProvider } from './local-pos-sync-provider';
import { ProductLookupStatus } from './product-lookup-status';
import { syncIndicators } from './sync-indicators';

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  profile: vi.fn(),
  subscribeProfile: vi.fn(),
}));
vi.mock('@renderer/common/lib/local-pos', () => ({
  callLocalPos: mocks.call,
  localPosActive: () => !!mocks.profile(),
  localPosProfile: mocks.profile,
  subscribeLocalPosProfile: mocks.subscribeProfile,
}));
const idle = (): PosStatus => ({
  sessionId: ids.session,
  connected: true,
  catalogReady: true,
  catalogUpdatedAt: '2026-09-08T01:00:00.000Z',
  catalogRevision: 'revision-1',
  catalogSyncing: false,
  syncing: false,
  productLookups: 0,
  conflicts: [],
  pending: 0,
  paymentPending: false,
  paymentReviews: [],
  authorizationRequired: false,
  tokenRefreshRequired: false,
  fiscalShiftExpired: false,
  error: null,
});
let state: PosStatus;
let notify: () => void;
let profileChanged: () => void;
const unsubscribe = vi.fn();
const clients: QueryClient[] = [];
beforeEach(() => {
  state = idle();
  mocks.profile.mockReturnValue(profileFixture());
  mocks.subscribeProfile.mockImplementation((listener) => {
    profileChanged = listener;
    return () => {};
  });
  mocks.call
    .mockReset()
    .mockImplementation(async ({ type }) =>
      type === 'status' ? { ...state } : null,
    );
  unsubscribe.mockClear();
  window.localPos = {
    request: vi.fn(),
    onChange: vi.fn((callback) => {
      notify = callback;
      return unsubscribe;
    }),
  };
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  delete window.localPos;
  vi.useRealTimers();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = (enabled: boolean, page: string) => (
    <QueryClientProvider client={client}>
      <LocalPosSyncProvider enabled={enabled}>
        <LocalPosSyncBar />
        <main aria-label={page}>
          <ProductLookupStatus />
          <button>Следующий товар</button>
        </main>
      </LocalPosSyncProvider>
    </QueryClientProvider>
  );
  const result = render(view(true, 'Продажи'));
  return { client, result, view };
}

it.each(['new-cart', 'new-revision', 'completed'] as const)(
  'does not overwrite %s with a stale worker current snapshot',
  async (mode) => {
    const { client } = mount();
    await screen.findByText('Каталог: синхронизирован');
    const key = queryKeys.sales.current(ids.session);
    const original = { id: 'cart-1', local_revision: 1 } as SaleResponse;
    client.setQueryData(key, original);
    let respond!: (sale: SaleResponse) => void;
    mocks.call.mockImplementation(({ type }) =>
      type === 'current'
        ? new Promise((resolve) => {
            respond = resolve;
          })
        : Promise.resolve(state),
    );
    act(() => notify());
    await waitFor(() => expect(respond).toBeDefined());
    const newer =
      mode === 'completed'
        ? null
        : {
            id: mode === 'new-cart' ? 'cart-2' : original.id,
            local_revision: 2,
          };
    client.setQueryData(key, newer);
    await act(async () => {
      respond(original);
    });
    expect(client.getQueryData(key)).toEqual(newer);
  },
);

it('keeps all concurrent operations visible without progress percentages or disabling controls', async () => {
  state = {
    ...state,
    catalogSyncing: true,
    catalogReady: false,
    catalogLoaded: 97001,
    catalogPhase: 'saving',
    syncing: true,
    pending: 3,
    productLookups: 2,
    categoriesSyncing: true,
    paymentPending: true,
  };
  mount();
  const catalog = await screen.findByRole('progressbar', {
    name: /Каталог: сохраняем/,
  });
  expect(catalog.textContent).toMatch(/97\s001/);
  expect(catalog.hasAttribute('aria-valuenow')).toBe(false);
  expect(
    screen.getByRole('progressbar', { name: 'Чеки: отправляем · 3' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('progressbar', { name: 'Поиск на сервере · 2' }),
  ).toBeTruthy();
  expect(screen.getByText('Категории: загружаем')).toBeTruthy();
  expect(screen.getByText('Оплаты: проверка')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain(
    'Можно сканировать следующий товар',
  );
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
  expect(window.localPos!.onChange).toHaveBeenCalledTimes(1);
  expect(
    mocks.call.mock.calls.filter(([request]) => request.type === 'status'),
  ).toHaveLength(1);
  expect(mocks.call).not.toHaveBeenCalledWith({ type: 'retry' });
});

it('keeps indicators across page switches and coalesces a burst of events into one status read', async () => {
  const { result, view } = mount();
  await screen.findByText('Каталог: синхронизирован');
  result.rerender(view(true, 'История продаж'));
  expect(screen.getByLabelText('История продаж')).toBeTruthy();
  expect(screen.getByLabelText('Синхронизация кассы')).toBeTruthy();
  mocks.call.mockClear();
  state = { ...state, catalogSyncing: true, catalogLoaded: 250 };
  act(() => {
    for (let i = 0; i < 50; i++) notify();
  });
  await screen.findByRole('progressbar', { name: /Каталог: загружаем/ });
  expect(
    mocks.call.mock.calls.filter(([request]) => request.type === 'status'),
  ).toHaveLength(1);
  expect(window.localPos!.onChange).toHaveBeenCalledTimes(1);
  state = idle();
  act(() => notify());
  await screen.findByText('Каталог: синхронизирован');
  expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
});

it('does not invalidate product queries just because a lookup spinner changes', async () => {
  const { client } = mount();
  await screen.findByText('Каталог: синхронизирован');
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  state = { ...state, productLookups: 1 };
  act(() => notify());
  await screen.findByRole('progressbar', { name: 'Поиск на сервере · 1' });
  expect(invalidation).not.toHaveBeenCalledWith({
    queryKey: queryKeys.products.all(),
  });
  state = { ...state, productLookups: 0, catalogRevision: 'revision-2' };
  act(() => notify());
  await waitFor(() =>
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.products.all(),
    }),
  );
});

it('does not show stale success after IPC failure and recovers on the next event', async () => {
  const { client } = mount();
  await screen.findByText('Каталог: синхронизирован');
  mocks.call.mockRejectedValueOnce(new Error('worker unavailable'));
  await act(() => client.invalidateQueries({ queryKey: localPosStatusKey }));
  await screen.findByText('Синхронизация: состояние неизвестно');
  expect(screen.queryByText('Каталог: синхронизирован')).toBeNull();
  act(() => notify());
  await screen.findByText('Каталог: синхронизирован');
});

it('hides status on logout, unsubscribes, and does not show the previous session on login', async () => {
  const { result, view } = mount();
  await screen.findByText('Каталог: синхронизирован');
  result.rerender(view(false, 'Вход'));
  expect(screen.queryByLabelText('Синхронизация кассы')).toBeNull();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  mocks.profile.mockReturnValue({
    ...profileFixture(),
    session: { ...profileFixture().session, id: 'another-session' },
  });
  result.rerender(view(true, 'Другая смена'));
  expect(screen.queryByText('Каталог: синхронизирован')).toBeNull();
});

it('distinguishes paused catalog, offline queue, access problems and unconfirmed payments from success', () => {
  let indicators = syncIndicators({
    ...idle(),
    connected: false,
    pending: 2,
    catalogError: 'Сервер занят',
    catalogLoaded: 500,
    catalogRetryAt: '2026-09-08T02:00:00.000Z',
  });
  expect(indicators[0]).toMatchObject({
    tone: 'warning',
    label: 'Каталог: пауза · 500',
  });
  expect(indicators[0]?.detail).toContain('Автоповтор не ранее');
  expect(indicators[1]).toMatchObject({
    tone: 'waiting',
    label: 'Чеки: в очереди · 2',
  });
  expect(indicators[1]?.detail).toContain('Локальный режим');
  indicators = syncIndicators({
    ...idle(),
    pending: 2,
    authorizationRequired: true,
    paymentPending: true,
  });
  expect(indicators[1]?.tone).toBe('warning');
  expect(indicators.some((item) => item.id === 'access')).toBe(true);
  expect(indicators.some((item) => item.id === 'payments')).toBe(true);
  // A fiscal review stays visible even if every draft change has already been sent.
  indicators = syncIndicators({ ...idle(), paymentPending: true });
  expect(indicators.some((item) => item.id === 'payments')).toBe(true);
  expect(indicators.find((item) => item.id === 'receipts')?.detail).toContain(
    'Подтверждение оплаты проверяется отдельно',
  );
});

it.each([
  [undefined, 'Синхронизация: требуется перезапуск POS'],
  [null, 'Синхронизация: нет подключения к смене'],
  [ids.register, 'Синхронизация: не совпадает смена'],
] as const)(
  'shows an actionable warning for session %s and a retry reads only status',
  async (sessionId, label) => {
    state.sessionId = sessionId;
    mount();
    await screen.findByText(label);
    expect(screen.queryByText('Проверяем синхронизацию…')).toBeNull();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.getByText(/перезапустите|остановите/i)).toBeTruthy();
    state = idle();
    mocks.call.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: 'Повторить проверку статуса' }),
    );
    await screen.findByText('Каталог: синхронизирован');
    expect(
      mocks.call.mock.calls.every(([request]) => request.type === 'status'),
    ).toBe(true);
  },
);

it('does not read an unconnected worker, and starts a fresh status read as soon as the profile is published', async () => {
  mocks.profile.mockReturnValue(null);
  mount();
  expect(mocks.call).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Синхронизация кассы')).toBeNull();
  act(() => {
    mocks.profile.mockReturnValue(profileFixture());
    profileChanged();
  });
  await screen.findByText('Каталог: синхронизирован');
  expect(mocks.call).toHaveBeenCalledWith({ type: 'status' });
});

it('expires a hung read without blocking the workspace or accumulating new requests', async () => {
  vi.useFakeTimers();
  mocks.call.mockReturnValue(new Promise(() => {}));
  mount();
  expect(screen.getByText('Проверяем синхронизацию…')).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(5001));
  expect(screen.queryByText('Проверяем синхронизацию…')).toBeNull();
  expect(
    screen.getByText('Синхронизация: локальный процесс не отвечает'),
  ).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: 'Следующий товар' })
      .hasAttribute('disabled'),
  ).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторить проверку статуса' }),
  );
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(mocks.call).toHaveBeenCalledTimes(1);
});
