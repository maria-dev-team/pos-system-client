import { describe, expect, it } from 'vitest';

import * as receiptDocument from './receipt-document';

type PrintableReceipt = receiptDocument.PrintableReceipt;

const renderReceiptDocument = (
  receiptDocument as unknown as {
    renderReceiptDocument?: (receipt: PrintableReceipt) => string;
  }
).renderReceiptDocument;

const receipt: PrintableReceipt = {
  cashier: 'Айжан Қасымова',
  completedAt: '2026-08-28T08:15:00.000Z',
  currency: 'KZT',
  fiscal: {
    address: 'Алматы, Абай 1',
    buyerBinIin: null,
    cashboxUniqueNumber: 'SWK00000001',
    fiscalSign: '123456789',
    offline: false,
    ofdName: 'ОФД',
    ofdWebsite: 'https://ofd.example',
    qrUrl: 'https://ofd.example/check/123',
    receiptNumber: '7',
    registrationNumber: 'RN-1',
    shiftNumber: '2',
    vatTotal: '0.00',
  },
  isTest: false,
  items: [
    {
      lineNumber: 2,
      lineTotal: '900.00',
      markingCode: null,
      name: 'Ұзын тауар <script>alert(1)</script>',
      ntinCode: 'NTIN-2',
      quantity: '0.500',
      unitLabel: 'кг',
      unitPrice: '1800.00',
      vatAmount: '0.00',
      vatRate: 'NONE',
    },
    {
      lineNumber: 1,
      lineTotal: '250.00',
      markingCode: null,
      name: 'Әже наны',
      ntinCode: 'NTIN-1',
      quantity: '1.000',
      unitLabel: 'шт.',
      unitPrice: '250.00',
      vatAmount: '0.00',
      vatRate: 'NONE',
    },
  ],
  localReceiptNumber: '42',
  operationType: 'SALE',
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
  store: { address: 'Алматы, Абай 1', name: 'Магазин №1' },
  timeZone: 'Asia/Almaty',
  total: '1150.00',
};

describe('receipt raster profiles', () => {
  it('maps 58 and 80 mm paper to their 203 dpi printable areas', () => {
    expect(receiptDocument.receiptPaperProfiles).toMatchObject({
      58: {
        dpi: 203,
        layoutWidthCss: 181,
        printableWidthMm: 48,
        printWidthDots: 384,
      },
      80: {
        dpi: 203,
        layoutWidthCss: 272,
        printableWidthMm: 72,
        printWidthDots: 576,
      },
    });
  });
});

describe('renderReceiptDocument', () => {
  it('renders Kazakh text and escapes receipt data in line order', () => {
    const html = renderReceiptDocument?.(receipt);

    expect(html).toContain('ФИСКАЛЬНЫЙ ЧЕК');
    expect(html).toContain('Фискальный признак');
    expect(html).toContain('QR-код фискального чека');
    expect(html).toContain('Айжан Қасымова');
    expect(html).toContain('Әже наны');
    expect(html).toContain('Ұзын тауар &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html?.indexOf('Әже наны')).toBeLessThan(
      html?.indexOf('Ұзын тауар') ?? -1,
    );
    expect(html).toContain('1 шт. × 250,00 ₸');
    expect(html).toContain('Получено: 1 200,00 ₸');
    expect(html).toContain('Сдача: 50,00 ₸');
  });

  it('matches regular ESC/POS Font A proportions without extra spacing', () => {
    const html = renderReceiptDocument?.(receipt);

    expect(html).toContain('html, body { background: #fff;');
    expect(html).toContain('scrollbar-width: none;');
    expect(html).toContain('html::-webkit-scrollbar { display: none; }');
    expect(html).toContain('font-size: 8.5pt;');
    expect(html).toContain('font-weight: 400;');
    expect(html).toContain('strong { font-weight: inherit; }');
    expect(html).toContain('padding: 0;');
    expect(html).toContain('overflow-wrap: anywhere;');
    expect(html).not.toMatch(/font-weight: (700|800)/);
    expect(html).not.toContain('font-size: 13pt;');
    expect(html).not.toContain('margin-top:');
    expect(html).not.toContain('padding: 0 8px;');
    expect(html).not.toContain('height: 90mm');
  });
});
