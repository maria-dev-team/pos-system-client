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
  items: [
    {
      lineNumber: 1,
      lineTotal: '100.00',
      name: 'Қазақша тауар',
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
): {
  deviceName: string;
  paperWidthMm: unknown;
  receipt: PrintableReceipt;
} => ({ deviceName: 'XP-58IIH', paperWidthMm, receipt });

const rasterWindow = (): {
  firstImage: Record<string, ReturnType<typeof vi.fn>>;
  printWindow: {
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    webContents: Record<string, ReturnType<typeof vi.fn>>;
  };
  secondImage: Record<string, ReturnType<typeof vi.fn>>;
} => {
  const firstBitmap = Buffer.alloc(384 * 255 * 4, 255);
  const secondBitmap = Buffer.alloc(384 * 2 * 4, 255);
  const firstResized = {
    toBitmap: vi.fn().mockReturnValue(firstBitmap),
  };
  const secondResized = {
    toBitmap: vi.fn().mockReturnValue(secondBitmap),
  };
  const firstImage = {
    resize: vi.fn().mockReturnValue(firstResized),
  };
  const secondImage = {
    resize: vi.fn().mockReturnValue(secondResized),
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
        .mockResolvedValueOnce(121)
        .mockResolvedValueOnce(181)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1),
    },
  };
  electron.BrowserWindow.mockImplementation(function BrowserWindowMock() {
    return printWindow;
  } as never);
  return { firstImage, printWindow, secondImage };
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
    const { firstImage, printWindow, secondImage } = rasterWindow();
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
        height: 120,
        show: false,
        webPreferences: expect.objectContaining({
          backgroundThrottling: false,
        }),
        width: 181,
      }),
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      1,
      { height: 120, width: 181, x: 0, y: 0 },
      { stayHidden: true },
    );
    expect(printWindow.webContents.capturePage).toHaveBeenNthCalledWith(
      2,
      { height: 1, width: 181, x: 0, y: 119 },
      { stayHidden: true },
    );
    expect(firstImage.resize).toHaveBeenCalledWith({
      height: 255,
      width: 384,
    });
    expect(secondImage.resize).toHaveBeenCalledWith({
      height: 2,
      width: 384,
    });
    expect(encoded.subarray(0, 10)).toEqual(
      Buffer.from([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0xff, 0x00]),
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
