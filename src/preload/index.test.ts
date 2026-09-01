import { expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn().mockResolvedValue({ ok: true }),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: { invoke: electron.invoke, send: electron.send },
}));

await import('./index');

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
