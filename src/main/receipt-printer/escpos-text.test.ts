import { describe, expect, it } from 'vitest';

import { buildEscPosTextReceipt } from './escpos-text';
import type { PrintableReceipt } from './receipt-document';

const receipt: PrintableReceipt = {
  cashier: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І',
  completedAt: '2026-08-28T08:15:00.000Z',
  currency: 'KZT',
  items: [
    {
      lineNumber: 1,
      lineTotal: '100.00',
      name: 'Қазақша тауар',
      quantity: '1',
      unitLabel: 'шт.',
      unitPrice: '100.00',
    },
  ],
  organization: { binIin: null, displayName: 'Maria POS', legalName: null },
  payments: [
    {
      amount: '100.00',
      change: null,
      method: 'CASHLESS',
      received: null,
    },
  ],
  receiptNumber: 'TEST',
  store: { address: null, name: 'Проверка принтера' },
  timeZone: 'Asia/Almaty',
  total: '100.00',
};

describe('buildEscPosTextReceipt', () => {
  it('selects the Xprinter text code page and emits RK1048 Kazakh bytes', () => {
    const encoded = buildEscPosTextReceipt(receipt, 58);

    expect(encoded.subarray(0, 15)).toEqual(
      Buffer.from([
        0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x17, 0x1d, 0x4c, 0x00, 0x00, 0x1d,
        0x57, 0x80, 0x01,
      ]),
    );
    expect(
      encoded.includes(
        Buffer.from(
          'a3 20 aa 20 8d 20 bd 20 a5 20 a1 20 af 20 8e 20 b2'.replaceAll(
            ' ',
            '',
          ),
          'hex',
        ),
      ),
    ).toBe(true);
    expect(encoded.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(false);
    expect(encoded.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x03]));
  });

  it('maps 80 mm paper to a 576-dot print area', () => {
    const encoded = buildEscPosTextReceipt(receipt, 80);

    expect(encoded.subarray(7, 15)).toEqual(
      Buffer.from([0x1d, 0x4c, 0x00, 0x00, 0x1d, 0x57, 0x40, 0x02]),
    );
  });
});
