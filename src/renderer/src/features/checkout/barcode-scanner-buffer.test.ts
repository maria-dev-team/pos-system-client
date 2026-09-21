import { describe, expect, it } from 'vitest';

import { BarcodeScannerBuffer } from './barcode-scanner-buffer';

function scan(
  buffer: BarcodeScannerBuffer,
  value: string,
  start = 1000,
  gap = 8,
  suffix = 'Enter',
): string | null {
  [...value].forEach((key, index) => buffer.accept(key, start + index * gap));
  return buffer.accept(suffix, start + value.length * gap);
}

describe('keyboard-wedge scanner framing', () => {
  it.each([
    '0001',
    '4870000000012',
    'CODE-128',
    ']d2010487000000001221A\x1d91B',
  ])('preserves a complete fast code %s', (value) => {
    expect(scan(new BarcodeScannerBuffer(), value)).toBe(value);
  });
  it('accepts Tab as a scanner suffix and keeps consecutive scans separate', () => {
    const buffer = new BarcodeScannerBuffer();
    expect(scan(buffer, '001234', 1000, 8, 'Tab')).toBe('001234');
    expect(scan(buffer, '005678', 1080)).toBe('005678');
  });
  it('does not treat slow manual typing, a short shortcut or a bare Enter as a scan', () => {
    expect(scan(new BarcodeScannerBuffer(), '001234', 1000, 150)).toBeNull();
    expect(scan(new BarcodeScannerBuffer(), 'abc')).toBeNull();
    expect(new BarcodeScannerBuffer().accept('Enter', 1000)).toBeNull();
    expect(new BarcodeScannerBuffer().accept('Tab', 1000)).toBeNull();
  });
  it('does not accept a fast suffix after a slow/interrupted prefix', () => {
    const buffer = new BarcodeScannerBuffer();
    buffer.accept('9', 1000);
    expect(scan(buffer, '001234', 1200)).toBeNull();
    buffer.accept('9', 2000);
    buffer.interrupt();
    expect(scan(buffer, '001234', 2010)).toBeNull();
    expect(scan(buffer, '001234', 3000)).toBe('001234');
  });
  it('expires abandoned input without auto-submitting it', () => {
    const buffer = new BarcodeScannerBuffer();
    buffer.accept('9', 1000);
    expect(scan(buffer, '001234', 1600)).toBe('001234');
    '001234'.split('').forEach((key, i) => buffer.accept(key, 2000 + i * 8));
    expect(buffer.accept('Enter', 2700)).toBeNull();
  });
  it('rejects overflow rather than scanning a truncated prefix or suffix', () => {
    expect(scan(new BarcodeScannerBuffer(), '1'.repeat(512))).toBe(
      '1'.repeat(512),
    );
    expect(scan(new BarcodeScannerBuffer(), '1'.repeat(520))).toBeNull();
  });
  it('ignores modifier key presses used within a code', () => {
    const buffer = new BarcodeScannerBuffer();
    buffer.accept('0', 1000);
    buffer.accept('1', 1008);
    buffer.accept('Shift', 1015);
    buffer.accept('A', 1016);
    buffer.accept('B', 1024);
    expect(buffer.accept('Enter', 1032)).toBe('01AB');
  });
});
