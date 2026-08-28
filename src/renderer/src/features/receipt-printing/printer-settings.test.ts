import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultReceiptPrinterSettings,
  readReceiptPrinterSettings,
  writeReceiptPrinterSettings,
} from './printer-settings';

describe('receipt printer settings', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the system printer and 384 dots', () => {
    expect(defaultReceiptPrinterSettings).toEqual({
      deviceName: null,
      printWidthDots: 384,
    });
    expect(readReceiptPrinterSettings()).toEqual(defaultReceiptPrinterSettings);
  });

  it('persists a selected system device and custom width', () => {
    expect(
      writeReceiptPrinterSettings({
        deviceName: 'XP-58IIH',
        printWidthDots: 512,
      }),
    ).toBe(true);

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      printWidthDots: 512,
    });
  });

  it('ignores malformed or unsafe stored values', () => {
    for (const stored of [
      { deviceName: 'XP-58IIH', printWidthDots: 127 },
      { deviceName: 'XP-58IIH', printWidthDots: 833 },
      { deviceName: 'XP-58IIH', printWidthDots: 384.5 },
      { deviceName: 'XP-58IIH', pageWidthMm: 58 },
    ]) {
      window.localStorage.setItem(
        'maria.receipt-printer',
        JSON.stringify(stored),
      );
      expect(readReceiptPrinterSettings()).toEqual({
        deviceName: null,
        printWidthDots: 384,
      });
    }
  });

  it('reports when settings cannot be stored', () => {
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('Storage unavailable');
      });

    expect(
      writeReceiptPrinterSettings({
        deviceName: null,
        printWidthDots: 384,
      }),
    ).toBe(false);
    setItem.mockRestore();
  });
});
