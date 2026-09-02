import { expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn().mockResolvedValue({ ok: true }),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
  },
}));

await import('./index');

const appUpdates = (): {
  continueWithoutUpdate: () => Promise<unknown>;
  getState: () => Promise<unknown>;
  onStateChange: (callback: (state: unknown) => void) => () => void;
  retryDownload: () => Promise<unknown>;
} => {
  const registration = electron.exposeInMainWorld.mock.calls.find(
    ([name]) => name === 'appUpdates',
  );
  if (!registration) throw new Error('App updates API was not exposed');
  return registration[1] as {
    continueWithoutUpdate: () => Promise<unknown>;
    getState: () => Promise<unknown>;
    onStateChange: (callback: (state: unknown) => void) => () => void;
    retryDownload: () => Promise<unknown>;
  };
};

it('gets update state through only the fixed getter channel', async () => {
  const state = {
    status: 'current',
    currentVersion: '1.0.0',
    availableVersion: null,
    downloadPercent: null,
    attempt: 1,
    restartAt: null,
  };
  electron.invoke.mockClear();
  electron.invoke.mockResolvedValue(state);

  await expect(appUpdates().getState()).resolves.toEqual(state);

  expect(electron.invoke).toHaveBeenCalledOnce();
  expect(electron.invoke).toHaveBeenCalledWith('app-updater:get-state');
});

it('passes only the update state payload to state change callbacks', () => {
  const state = {
    status: 'downloading',
    currentVersion: '1.0.0',
    availableVersion: '1.1.0',
    downloadPercent: 42,
    attempt: 1,
    restartAt: null,
  };
  const callback = vi.fn();
  electron.on.mockClear();

  appUpdates().onStateChange(callback);

  const listener = electron.on.mock.calls[0]?.[1] as
    ((event: unknown, nextState: unknown) => void) | undefined;
  if (!listener) throw new Error('State listener was not registered');
  listener({ sender: 'main' }, state);

  expect(callback.mock.calls).toEqual([[state]]);
});

it('unsubscribes the exact listener registered for update state changes', () => {
  const callback = vi.fn();
  electron.on.mockClear();
  electron.removeListener.mockClear();

  const unsubscribe = appUpdates().onStateChange(callback);
  const listener = electron.on.mock.calls[0]?.[1];
  unsubscribe();

  expect(electron.removeListener).toHaveBeenCalledOnce();
  expect(electron.removeListener).toHaveBeenCalledWith(
    'app-updater:state-changed',
    listener,
  );
});

it('uses only fixed channels for update retry and continue actions', async () => {
  electron.invoke.mockClear();

  await appUpdates().retryDownload();
  await appUpdates().continueWithoutUpdate();

  expect(electron.invoke.mock.calls).toEqual([
    ['app-updater:retry-download'],
    ['app-updater:continue'],
  ]);
});

it('exposes no arbitrary IPC methods through the update API', () => {
  const api = appUpdates() as Record<string, unknown>;

  expect(Object.keys(api).sort()).toEqual([
    'continueWithoutUpdate',
    'getState',
    'onStateChange',
    'retryDownload',
  ]);
  expect(api).not.toHaveProperty('invoke');
  expect(api).not.toHaveProperty('on');
  expect(api).not.toHaveProperty('send');
});

it('forwards the selected raster threshold through the safe preload API', async () => {
  const registration = electron.exposeInMainWorld.mock.calls.find(
    ([name]) => name === 'receiptPrinter',
  );
  const api = registration?.[1] as {
    print: (request: Record<string, unknown>) => Promise<unknown>;
  };
  const receipt = {
    cashier: 'Кассир',
    completedAt: '2026-08-28T08:15:00.000Z',
    currency: 'KZT',
    items: [
      {
        lineNumber: 1,
        lineTotal: '100.00',
        name: 'Товар',
        quantity: '1',
        unitLabel: 'шт.',
        unitPrice: '100.00',
      },
    ],
    organization: {
      binIin: null,
      displayName: 'Организация',
      legalName: null,
    },
    payments: [
      {
        amount: '100.00',
        change: null,
        method: 'CASHLESS',
        received: null,
      },
    ],
    receiptNumber: '1',
    store: { address: null, name: 'Магазин' },
    timeZone: 'Asia/Almaty',
    total: '100.00',
  };

  await api.print({
    deviceName: 'XP-58IIH',
    paperWidthMm: 58,
    rasterThreshold: 112,
    receipt,
  });

  expect(electron.invoke).toHaveBeenCalledWith('receipt-printer:print', {
    deviceName: 'XP-58IIH',
    paperWidthMm: 58,
    rasterThreshold: 112,
    receipt,
  });
});

it('exposes a dedicated shift report print method without arbitrary IPC access', async () => {
  const registration = electron.exposeInMainWorld.mock.calls.find(
    ([name]) => name === 'receiptPrinter',
  );
  const api = registration?.[1] as {
    printShiftReport?: (request: Record<string, unknown>) => Promise<unknown>;
  };
  expect(api.printShiftReport).toBeTypeOf('function');
  if (!api.printShiftReport) return;
  const request = {
    deviceName: null,
    paperWidthMm: 80,
    rasterThreshold: 192,
    report: { reportType: 'X' },
  };

  await api.printShiftReport(request);

  expect(electron.invoke).toHaveBeenCalledWith(
    'receipt-printer:print-shift-report',
    request,
  );
  expect(api).not.toHaveProperty('invoke');
});
