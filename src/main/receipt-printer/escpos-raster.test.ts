import { describe, expect, it } from 'vitest';

import { buildEscPosReceipt, encodeRasterBand } from './escpos-raster';

const pixel = (gray: number): number[] => [gray, gray, gray, 255];

describe('encodeRasterBand', () => {
  it('packs black pixels from the most-significant bit and pads a 9-dot row white', () => {
    const bitmap = Buffer.from([
      ...pixel(0),
      ...pixel(255),
      ...pixel(255),
      ...pixel(255),
      ...pixel(255),
      ...pixel(255),
      ...pixel(255),
      ...pixel(0),
      ...pixel(0),
    ]);

    expect(encodeRasterBand(bitmap, 9, 1)).toEqual(
      Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x02, 0x00, 0x01, 0x00, 0x81, 0x80]),
    );
  });

  it('prints 191 as black and keeps the 192 threshold white', () => {
    const bitmap = Buffer.from([...pixel(191), ...pixel(192)]);

    expect(encodeRasterBand(bitmap, 2, 1).at(-1)).toBe(0x80);
  });

  it('accepts the full 256-row raster boundary', () => {
    const bitmap = Buffer.alloc(4 * 256, 255);
    bitmap.set(pixel(0), bitmap.length - 4);

    const band = encodeRasterBand(bitmap, 1, 256);

    expect(band.subarray(4, 8)).toEqual(Buffer.from([0x01, 0x00, 0x00, 0x01]));
    expect(band).toHaveLength(264);
    expect(band.at(-1)).toBe(0x80);
  });

  it('handles alpha-first or alpha-last monochrome bytes without channel assumptions', () => {
    const bitmap = Buffer.from([255, 0, 0, 0, 255, 255, 255, 255]);

    expect(encodeRasterBand(bitmap, 2, 1).at(-1)).toBe(0x80);
  });

  it('rejects malformed or over-height bands', () => {
    expect(() => encodeRasterBand(Buffer.alloc(3), 1, 1)).toThrow(
      'Invalid raster bitmap',
    );
    expect(() => encodeRasterBand(Buffer.alloc(4 * 257), 1, 257)).toThrow(
      'Invalid raster dimensions',
    );
  });
});

describe('buildEscPosReceipt', () => {
  it('initializes once, emits no leading feed, and appends three feed lines', () => {
    const band = Buffer.from([0x1d, 0x76]);
    expect(buildEscPosReceipt([band])).toEqual(
      Buffer.from([0x1b, 0x40, 0x1d, 0x76, 0x1b, 0x64, 0x03]),
    );
  });
});
