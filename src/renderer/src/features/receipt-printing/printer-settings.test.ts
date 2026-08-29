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
      rasterThreshold: 112,
    });
    expect(readReceiptPrinterSettings()).toEqual(defaultReceiptPrinterSettings);
  });

  it('persists a selected system device and supported paper width', () => {
    expect(
      writeReceiptPrinterSettings({
        deviceName: 'XP-58IIH',
        paperWidthMm: 80,
        rasterThreshold: 112,
      }),
    ).toBe(true);

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 80,
      rasterThreshold: 112,
    });
  });

  it('ignores malformed or unsafe stored values', () => {
    for (const stored of [
      { deviceName: 'XP-58IIH', paperWidthMm: 57 },
      { deviceName: 'XP-58IIH', paperWidthMm: 81 },
      { deviceName: 'XP-58IIH', paperWidthMm: '58' },
      { deviceName: 'XP-58IIH', paperWidthMm: 58, rasterThreshold: 111 },
      { deviceName: 'XP-58IIH', paperWidthMm: 58, rasterThreshold: 161 },
    ]) {
      window.localStorage.setItem(
        'maria.receipt-printer',
        JSON.stringify(stored),
      );
      expect(readReceiptPrinterSettings()).toEqual({
        deviceName: null,
        paperWidthMm: 58,
        rasterThreshold: 112,
      });
    }
  });

  it('adds the thin thickness to settings saved before raster tuning existed', () => {
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'XP-58IIH', paperWidthMm: 58 }),
    );

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 58,
      rasterThreshold: 112,
    });
  });

  it('migrates the internal dot presets without exposing them again', () => {
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'XP-58IIH', printWidthDots: 576 }),
    );

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 80,
      rasterThreshold: 112,
    });
  });

  it('keeps hidden thresholds compatible but reads them as thin', () => {
    expect(
      writeReceiptPrinterSettings({
        deviceName: 'XP-58IIH',
        paperWidthMm: 58,
        rasterThreshold: 192,
      }),
    ).toBe(true);

    expect(readReceiptPrinterSettings()).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 58,
      rasterThreshold: 112,
    });
  });

  it('reports when settings cannot be stored', () => {
    const storage = window.localStorage;
    const setItem = vi
      .spyOn(
        Object.hasOwn(storage, 'setItem')
          ? storage
          : Object.getPrototypeOf(storage),
        'setItem',
      )
      .mockImplementationOnce(() => {
        throw new Error('Storage unavailable');
      });

    expect(
      writeReceiptPrinterSettings({
        deviceName: null,
        paperWidthMm: 58,
        rasterThreshold: 160,
      }),
    ).toBe(false);
    setItem.mockRestore();
  });
});
