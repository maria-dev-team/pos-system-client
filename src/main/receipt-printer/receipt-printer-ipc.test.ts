import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrintableReceipt } from './receipt-document';
import { registerReceiptPrinterIpc } from './receipt-printer-ipc';

const electron = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));
const raw = vi.hoisted(() => {
  class DefaultPrinterNotFoundError extends Error {}
  return { DefaultPrinterNotFoundError, sendRawReceipt: vi.fn() };
});

vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('./raw-printer', () => raw);

const receipt: PrintableReceipt = {
  cashier: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І',
  completedAt: '2026-08-28T08:15:00.000Z',
  currency: 'KZT',
  fiscal: {
    address: 'Алматы',
    buyerBinIin: null,
    cashboxUniqueNumber: 'SWK00000001',
    fiscalSign: '123456789',
    offline: false,
    ofdName: 'ОФД',
    ofdWebsite: 'https://ofd.example',
    qrUrl: 'https://ofd.example/check/1',
    receiptNumber: '1',
    registrationNumber: 'RN-1',
    shiftNumber: '1',
    vatTotal: '0.00',
  },
  isTest: false,
  items: [
    {
      lineNumber: 1,
      lineTotal: '100.00',
      markingCode: null,
      name: 'Қазақша тауар',
      ntinCode: 'NTIN-1',
      quantity: '1.000',
      unitLabel: 'шт.',
      unitPrice: '100.00',
      vatAmount: '0.00',
      vatRate: 'NONE',
    },
  ],
  localReceiptNumber: '1',
  operationType: 'SALE',
  organization: { binIin: null, displayName: 'Организация', legalName: null },
  payments: [
    { amount: '100.00', change: null, method: 'CASHLESS', received: null },
  ],
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

const register = (
  getPrintersAsync = vi.fn().mockResolvedValue([printer]),
): { getPrintersAsync: typeof getPrintersAsync } => {
  const mainWebContents = { getPrintersAsync };
  registerReceiptPrinterIpc({
    on: vi.fn(),
    webContents: mainWebContents,
  } as never);
  return mainWebContents;
};

const request = (
  paperWidthMm: unknown = 58,
  rasterThreshold: unknown = 160,
): {
  deviceName: string;
  paperWidthMm: unknown;
  rasterThreshold: unknown;
  receipt: PrintableReceipt;
} => ({ deviceName: 'XP-58IIH', paperWidthMm, rasterThreshold, receipt });

const rasterWindow = (): {
  images: Array<Record<string, ReturnType<typeof vi.fn>>>;
  printWindow: {
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    webContents: Record<string, ReturnType<typeof vi.fn>>;
  };
} => {
  const images = [64, 63, 64, 64, 2].map((height) => ({
    resize: vi.fn().mockReturnValue({
      toBitmap: vi.fn().mockReturnValue(Buffer.alloc(384 * height * 4, 255)),
    }),
  }));
  const capturePage = vi.fn();
  images.forEach((image) => capturePage.mockResolvedValueOnce(image));
  const printWindow = {
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    webContents: {
      capturePage,
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce(121)
        .mockResolvedValueOnce(181)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(60)
        .mockResolvedValueOnce(90)
        .mockResolvedValueOnce(91),
    },
  };
  electron.BrowserWindow.mockImplementation(function BrowserWindowMock() {
    return printWindow;
  } as never);
  return { images, printWindow };
};

describe('registerReceiptPrinterIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it.each([57, 81, 384, '58'])(
    'rejects unsupported paper width %s before transport',
    async (paperWidthMm) => {
      const mainWebContents = register();

      await expect(
        handlerFor('receipt-printer:print')(
          { sender: mainWebContents },
          request(paperWidthMm),
        ),
      ).resolves.toEqual({
        code: 'PRINT_FAILED',
        message: 'Некорректные данные чека.',
        ok: false,
      });
      expect(raw.sendRawReceipt).not.toHaveBeenCalled();
    },
  );

  it.each([0, 111, 161, 192.5, '160'])(
    'rejects unsupported raster threshold %s before rendering',
    async (rasterThreshold) => {
      rasterWindow();
      const mainWebContents = register();

      await expect(
        handlerFor('receipt-printer:print')(
          { sender: mainWebContents },
          request(58, rasterThreshold),
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

  it('rejects the retired dot-width request shape', async () => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        { deviceName: 'XP-58IIH', printWidthDots: 384, receipt },
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Некорректные данные чека.',
      ok: false,
    });
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ['items', { ...receipt, items: Array(1) }],
    ['payments', { ...receipt, payments: Array(1) }],
  ])('rejects a sparse %s array', async (_, sparseReceipt) => {
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        { ...request(), receipt: sparseReceipt },
      ),
    ).resolves.toEqual({
      code: 'PRINT_FAILED',
      message: 'Некорректные данные чека.',
      ok: false,
    });
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
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
  });

  it('does not print when no printers are available', async () => {
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
    expect(raw.sendRawReceipt).not.toHaveBeenCalled();
  });

  it('renders at 96 CSS dpi and scales both axes to the 203 dpi 58 mm raster', async () => {
    const { images, printWindow } = rasterWindow();
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        request(58),
      ),
    ).resolves.toEqual({ ok: true });

    const encoded = raw.sendRawReceipt.mock.calls[0]?.[1] as Buffer;
    expect(raw.sendRawReceipt).toHaveBeenCalledWith('XP-58IIH', encoded);
    expect(electron.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        height: 30,
        show: false,
        webPreferences: expect.objectContaining({
          backgroundThrottling: false,
        }),
        width: 181,
      }),
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      1,
      { height: 30, width: 181, x: 0, y: 0 },
      { stayHidden: true },
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      5,
      { height: 1, width: 181, x: 0, y: 29 },
      { stayHidden: true },
    );
    expect(printWindow.webContents.capturePage).toHaveBeenCalledTimes(5);
    expect(images[0]?.resize).toHaveBeenCalledWith({
      height: 64,
      width: 384,
    });
    expect(images[4]?.resize).toHaveBeenCalledWith({
      height: 2,
      width: 384,
    });
    expect(encoded.subarray(0, 12)).toEqual(
      Buffer.from([
        0x1b, 0x40, 0x1c, 0x2e, 0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0x40, 0x00,
      ]),
    );
    expect(encoded.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x03]));
    expect(encoded.includes(Buffer.from([0x1b, 0x74, 0x17]))).toBe(false);
    expect(printWindow.destroy).toHaveBeenCalledOnce();
  });

  it('maps a missing default system printer to a cashier-safe result', async () => {
    rasterWindow();
    raw.sendRawReceipt.mockRejectedValue(
      new raw.DefaultPrinterNotFoundError('not configured'),
    );
    const mainWebContents = register();

    await expect(
      handlerFor('receipt-printer:print')(
        { sender: mainWebContents },
        { ...request(), deviceName: null },
      ),
    ).resolves.toEqual({
      code: 'PRINTER_NOT_FOUND',
      message: 'Системный принтер по умолчанию не настроен.',
      ok: false,
    });
  });

  it('returns a cashier-safe transport failure', async () => {
    rasterWindow();
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
