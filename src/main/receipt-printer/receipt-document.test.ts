import { describe, expect, it } from 'vitest';

import * as receiptDocument from './receipt-document';

type PrintableReceipt = receiptDocument.PrintableReceipt;

const renderReceiptText = (
  receiptDocument as unknown as {
    renderReceiptText: (
      receipt: PrintableReceipt,
      paperWidthMm: 58 | 80,
    ) => string;
  }
).renderReceiptText;

const receipt: PrintableReceipt = {
  cashier: 'Айжан Қасымова',
  completedAt: '2026-08-28T08:15:00.000Z',
  currency: 'KZT',
  items: [
    {
      lineNumber: 2,
      lineTotal: '900.00',
      name: 'Ұзын тауар <script>alert(1)</script>',
      quantity: '0.500',
      unitLabel: 'кг',
      unitPrice: '1800.00',
    },
    {
      lineNumber: 1,
      lineTotal: '250.00',
      name: 'Әже наны',
      quantity: '1.000',
      unitLabel: 'шт.',
      unitPrice: '250.00',
    },
  ],
  organization: {
    binIin: '123456789012',
    displayName: 'Maria Market',
    legalName: 'ТОО «Maria»',
  },
  payments: [
    {
      amount: '1150.00',
      change: '50.00',
      method: 'CASH',
      received: '1200.00',
    },
  ],
  receiptNumber: '42',
  store: { address: 'Алматы, Абай 1', name: 'Магазин №1' },
  timeZone: 'Asia/Almaty',
  total: '1150.00',
};

describe('renderReceiptText', () => {
  it('formats and wraps a 58 mm receipt within 32 characters', () => {
    const text = renderReceiptText(receipt, 58);

    expect(text).toContain('НЕФИСКАЛЬНЫЙ ЧЕК');
    expect(text).toContain('НЕ ЯВЛЯЕТСЯ ФИСКАЛЬНЫМ');
    expect(text).toContain('Айжан Қасымова');
    expect(text).toContain('Әже наны');
    expect(text).toContain('Ұзын тауар');
    expect(text).toContain('<script>alert(1)</script>');
    expect(text.indexOf('Әже наны')).toBeLessThan(text.indexOf('Ұзын тауар'));
    expect(text).toContain('1 шт. x 250,00 KZT');
    expect(text).toContain('Получено: 1 200,00 KZT');
    expect(text).toContain('Сдача: 50,00 KZT');
    expect(text.split('\n').every((line) => [...line].length <= 32)).toBe(true);
  });

  it('uses 48 columns for 80 mm paper', () => {
    const text = renderReceiptText(receipt, 80);

    expect(text).toContain('-'.repeat(48));
    expect(text.split('\n').every((line) => [...line].length <= 48)).toBe(true);
  });
});
