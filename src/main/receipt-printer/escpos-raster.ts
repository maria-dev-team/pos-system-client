const RASTER_HEADER = Buffer.from([0x1d, 0x76, 0x30, 0x00]);
export const MAX_RASTER_BAND_HEIGHT_DOTS = 64;

export const encodeRasterBand = (
  bitmap: Buffer,
  width: number,
  height: number,
  threshold = 160,
): Buffer => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    height > MAX_RASTER_BAND_HEIGHT_DOTS
  ) {
    throw new Error('Invalid raster dimensions');
  }
  if (bitmap.length !== width * height * 4) {
    throw new Error('Invalid raster bitmap');
  }
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error('Invalid raster threshold');
  }

  const rowBytes = Math.ceil(width / 8);
  const raster = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4;
      const gray = Math.min(
        bitmap[pixelOffset] ?? 255,
        bitmap[pixelOffset + 1] ?? 255,
        bitmap[pixelOffset + 2] ?? 255,
      );
      if (gray < threshold) {
        const byteOffset = y * rowBytes + Math.floor(x / 8);
        raster[byteOffset] = (raster[byteOffset] ?? 0) | (0x80 >> (x % 8));
      }
    }
  }
  for (let offset = 0; offset < raster.length; offset += 1) {
    // XP-58IIH treats DC3/XOFF as flow control even inside raster data.
    if (raster[offset] === 0x13) raster[offset] = 0x12;
  }

  return Buffer.concat([
    RASTER_HEADER,
    Buffer.from([
      rowBytes & 0xff,
      (rowBytes >> 8) & 0xff,
      height & 0xff,
      (height >> 8) & 0xff,
    ]),
    raster,
  ]);
};

export const buildEscPosReceipt = (bands: readonly Buffer[]): Buffer =>
  Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1c, 0x2e]),
    ...bands,
    Buffer.from([0x1b, 0x64, 0x03]),
  ]);
