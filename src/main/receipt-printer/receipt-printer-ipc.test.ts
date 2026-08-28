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

const rasterWindow = (contentHeight = 300, scrollY = [0, 44]) => {
  const firstBitmap = Buffer.from([1]);
  const secondBitmap = Buffer.from([2]);
  const firstImage = {
    resize: vi.fn().mockReturnThis(),
    toBitmap: vi.fn().mockReturnValue(firstBitmap),
  };
  const secondImage = {
    resize: vi.fn().mockReturnThis(),
    toBitmap: vi.fn().mockReturnValue(secondBitmap),
  };
  const printWindow = {
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: {
      capturePage: vi
        .fn()
        .mockResolvedValueOnce(firstImage)
        .mockResolvedValueOnce(secondImage),
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce(contentHeight)
        .mockResolvedValueOnce(scrollY[0])
        .mockResolvedValueOnce(scrollY[1]),
    },
  };
  electron.BrowserWindow.mockImplementation(function BrowserWindowMock() {
    return printWindow;
  } as never);
  return { firstBitmap, firstImage, printWindow, secondBitmap, secondImage };
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

  it('captures, encodes, and sends every source row when the bottom scroll is clamped', async () => {
    const encodedFirstBand = Buffer.from([0x1d, 1]);
    const encodedSecondBand = Buffer.from([0x1d, 2]);
    const finalReceipt = Buffer.from([0x1b, 0x40]);
    raster.encodeRasterBand
      .mockReturnValueOnce(encodedFirstBand)
      .mockReturnValueOnce(encodedSecondBand);
    raster.buildEscPosReceipt.mockReturnValueOnce(finalReceipt);
    const { firstBitmap, firstImage, printWindow, secondBitmap, secondImage } =
      rasterWindow();
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
    expect(printWindow.webContents.executeJavaScript).toHaveBeenNthCalledWith(
      1,
      'document.fonts.ready.then(() => Math.ceil(document.documentElement.scrollHeight))',
      true,
    );
    expect(printWindow.webContents.executeJavaScript).toHaveBeenNthCalledWith(
      2,
      'new Promise((resolve) => { scrollTo(0, 0); requestAnimationFrame(() => resolve(window.scrollY)); })',
      true,
    );
    expect(printWindow.webContents.executeJavaScript).toHaveBeenNthCalledWith(
      3,
      'new Promise((resolve) => { scrollTo(0, 256); requestAnimationFrame(() => resolve(window.scrollY)); })',
      true,
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      1,
      { height: 256, width: 384, x: 0, y: 0 },
      { stayHidden: true },
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      2,
      { height: 44, width: 384, x: 0, y: 212 },
      { stayHidden: true },
    );
    expect(firstImage.resize).toHaveBeenCalledWith({ height: 256, width: 384 });
    expect(secondImage.resize).toHaveBeenCalledWith({ height: 44, width: 384 });
    expect(firstImage.toBitmap).toHaveBeenCalledWith({ scaleFactor: 1 });
    expect(secondImage.toBitmap).toHaveBeenCalledWith({ scaleFactor: 1 });
    expect(raster.encodeRasterBand).toHaveBeenNthCalledWith(
      1,
      firstBitmap,
      384,
      256,
    );
    expect(raster.encodeRasterBand).toHaveBeenNthCalledWith(
      2,
      secondBitmap,
      384,
      44,
    );
    expect(raster.buildEscPosReceipt).toHaveBeenCalledWith([
      encodedFirstBand,
      encodedSecondBand,
    ]);
    expect(raw.sendRawReceipt).toHaveBeenCalledWith('XP-58IIH', finalReceipt);
    expect(printWindow.destroy).toHaveBeenCalledOnce();
  });

  it('rejects an invalid actual scroll position without starting transport', async () => {
    const { printWindow } = rasterWindow(300, [0, Number.NaN]);
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Не удалось подготовить чек для печати.',
      ok: false,
    });
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
    expect(printWindow.destroy).toHaveBeenCalledOnce();
  });

  it('does not disclose capture failures to the cashier', async () => {
    const { printWindow } = rasterWindow();
    printWindow.webContents.capturePage
      .mockReset()
      .mockRejectedValue(new Error('internal path /tmp/cashier-data'));
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Не удалось подготовить чек для печати.',
      ok: false,
    });
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
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

  it('does not disclose an unreviewed transport failure to the cashier', async () => {
    rasterWindow();
    raw.sendRawReceipt.mockRejectedValue(
      new Error('internal queue diagnostic /var/spool/private'),
    );
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(),
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Не удалось напечатать чек.',
      ok: false,
    });
  });
});
