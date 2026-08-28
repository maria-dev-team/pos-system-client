import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrintableReceipt } from './receipt-document';
import { registerReceiptPrinterIpc } from './receipt-printer-ipc';

const electron = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));
const raster = vi.hoisted(() => ({
  buildEscPosReceipt: vi.fn(),
  encodeRasterBand: vi.fn(),
}));
const raw = vi.hoisted(() => {
  class DefaultPrinterNotFoundError extends Error {}
  return { DefaultPrinterNotFoundError, sendRawReceipt: vi.fn() };
});

vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('./escpos-raster', () => raster);
vi.mock('./raw-printer', () => raw);

const receipt: PrintableReceipt = {
  cashier: 'Кассир',
  completedAt: '2026-08-28T08:15:00.000Z',
  currency: 'KZT',
  items: [
    {
      lineNumber: 1,
      lineTotal: '100.00',
      name: 'Товар',
      quantity: '1.000',
      unitLabel: 'шт.',
      unitPrice: '100.00',
    },
  ],
  organization: { binIin: null, displayName: 'Организация', legalName: null },
  payments: [
    { amount: '100.00', change: null, method: 'CASHLESS', received: null },
  ],
  receiptNumber: '1',
  store: { address: null, name: 'Магазин' },
  timeZone: 'Asia/Almaty',
  total: '100.00',
};

type Handler = (event: { sender: unknown }, request?: unknown) => unknown;

const handlerFor = (channel: string): Handler => {
  const registration = electron.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );
  if (!registration) throw new Error(`Handler ${channel} was not registered`);
  return registration[1] as Handler;
};

const printer = {
  description: 'USB',
  displayName: 'XPrinter',
  name: 'XP-58IIH',
};

const register = (getPrintersAsync = vi.fn().mockResolvedValue([printer])) => {
  const mainWebContents = { getPrintersAsync };
  registerReceiptPrinterIpc({
    on: vi.fn(),
    webContents: mainWebContents,
  } as never);
  return mainWebContents;
};

const request = (printWidthDots = 384) => ({
  deviceName: 'XP-58IIH',
  printWidthDots,
  receipt,
});

const rasterWindow = (contentHeight = 300) => {
  const image = {
    resize: vi.fn().mockReturnThis(),
    toBitmap: vi.fn().mockReturnValue(Buffer.alloc(1)),
  };
  const printWindow = {
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: {
      capturePage: vi.fn().mockResolvedValue(image),
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce(contentHeight)
        .mockResolvedValue(true),
    },
  };
  electron.BrowserWindow.mockImplementation(function BrowserWindowMock() {
    return printWindow;
  } as never);
  return { image, printWindow };
};

describe('registerReceiptPrinterIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    raster.encodeRasterBand.mockReturnValue(Buffer.from([0x1d]));
    raster.buildEscPosReceipt.mockReturnValue(Buffer.from([0x1b]));
    raw.sendRawReceipt.mockResolvedValue(undefined);
  });

  it('rejects printer access from another WebContents', async () => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:get-printers')({ sender: {} }),
    ).rejects.toThrow('Unauthorized receipt printer request');
    expect(mainWebContents.getPrintersAsync).not.toHaveBeenCalled();
  });

  it('returns printer details for the main renderer', async () => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:get-printers')({ sender: mainWebContents }),
    ).resolves.toEqual([printer]);
  });

  it.each([127, 833, 384.5])(
    'rejects an invalid %i-dot print request before rendering or transport',
    async (printWidthDots) => {
      const mainWebContents = register();

      await expect(
        handlerFor('receipt-printer:print')(
          { sender: mainWebContents },
          request(printWidthDots),
        ),
      ).resolves.toEqual({
        code: 'PRINT_FAILED',
        message: 'Некорректные данные чека.',
        ok: false,
      });
      expect(electron.BrowserWindow).not.toHaveBeenCalled();
      expect(raw.sendRawReceipt).not.toHaveBeenCalled();
    },
  );

  it('rejects the retired millimetre request shape before rendering or transport', async () => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        { deviceName: 'XP-58IIH', pageWidthMm: 58, receipt },
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Некорректные данные чека.',
      ok: false,
    });
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
  });

  it('does not silently fall back when the selected printer is missing', async () => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        { ...request(), deviceName: 'Missing printer' },
      ),
    ).resolves.toEqual({
      code: 'PRINTER_NOT_FOUND',
      message: 'Выбранный принтер недоступен.',
      ok: false,
    });
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  it('does not render when no printers are available', async () => {
    const mainWebContents = register(vi.fn().mockResolvedValue([]));

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({
      code: 'NO_PRINTER',
      message: 'В системе не найдено ни одного принтера.',
      ok: false,
    });
    expect(electron.BrowserWindow).not.toHaveBeenCalled();
  });

  it('captures, encodes, and sends all raster bands before destroying the hidden window', async () => {
    const { printWindow } = rasterWindow();
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({ ok: true });

    expect(electron.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        backgroundColor: '#ffffff',
        height: 256,
        show: false,
        width: 384,
      }),
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      1,
      { height: 256, width: 384, x: 0, y: 0 },
      { stayHidden: true },
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      2,
      { height: 44, width: 384, x: 0, y: 0 },
      { stayHidden: true },
    );
    expect(raw.sendRawReceipt).toHaveBeenCalledWith(
      'XP-58IIH',
      expect.any(Buffer),
    );
    expect(printWindow.destroy).toHaveBeenCalledOnce();
  });

  it.each([0, Number.POSITIVE_INFINITY])(
    'reports a non-positive or non-finite measured height without transport',
    async (height) => {
      const { printWindow } = rasterWindow(height);
      const mainWebContents = register();

      await expect(
        handlerFor('receipt-printer:print')(
          { sender: mainWebContents },
          request(),
        ),
      ).resolves.toEqual({
        code: 'PRINT_FAILED',
        message: 'Не удалось определить размер чека.',
        ok: false,
      });
      expect(raw.sendRawReceipt).not.toHaveBeenCalled();
      expect(printWindow.destroy).toHaveBeenCalledOnce();
    },
  );

  it('maps a missing default system printer to a cashier-safe result', async () => {
    rasterWindow();
    raw.sendRawReceipt.mockRejectedValue(
      new raw.DefaultPrinterNotFoundError('not configured'),
    );
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        {
          ...request(),
          deviceName: null,
        },
      ),
    ).resolves.toEqual({
      code: 'PRINTER_NOT_FOUND',
      message: 'Системный принтер по умолчанию не настроен.',
      ok: false,
    });
  });

  it('returns a cashier-safe transport failure and destroys the window', async () => {
    const { printWindow } = rasterWindow();
    raw.sendRawReceipt.mockRejectedValue(
      new Error('Системная очередь печати отклонила чек.'),
    );
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Системная очередь печати отклонила чек.',
      ok: false,
    });
    expect(printWindow.destroy).toHaveBeenCalledOnce();
  });
});
