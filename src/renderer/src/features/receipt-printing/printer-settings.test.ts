import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultReceiptPrinterSettings,
  readReceiptPrinterSettings,
  writeReceiptPrinterSettings,
} from './printer-settings';

describe('receipt printer settings', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the system printer and 58 mm paper', () => {
    expect(defaultReceiptPrinterSettings).toEqual({
      deviceName: null,
      paperWidthMm: 58,
    });
    expect(readReceiptPrinterSettings()).toEqual(defaultReceiptPrinterSettings);
  });

  it('persists a selected system device and supported paper width', () => {
    expect(
      writeReceiptPrinterSettings({
        deviceName: 'XP-58IIH',
        paperWidthMm: 80,
      }),
    ).toBe(true);

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 80,
    });
  });

  it('ignores malformed or unsafe stored values', () => {
    for (const stored of [
      { deviceName: 'XP-58IIH', paperWidthMm: 57 },
      { deviceName: 'XP-58IIH', paperWidthMm: 81 },
      { deviceName: 'XP-58IIH', paperWidthMm: '58' },
    ]) {
      window.localStorage.setItem(
        'maria.receipt-printer',
        JSON.stringify(stored),
      );
      expect(readReceiptPrinterSettings()).toEqual({
        deviceName: null,
        paperWidthMm: 58,
      });
    }
  });

  it('migrates the internal dot presets without exposing them again', () => {
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'XP-58IIH', printWidthDots: 576 }),
    );

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 80,
    });
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
        paperWidthMm: 58,
      }),
    ).toBe(false);
    setItem.mockRestore();
  });
});
