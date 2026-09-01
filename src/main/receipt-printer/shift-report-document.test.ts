import { describe, expect, it } from 'vitest';

import {
  type PrintableShiftReport,
  renderShiftReportDocument,
} from './shift-report-document';

const report: PrintableShiftReport = {
  cash: { balance: '720.00', deposited: '100.00', withdrawn: '20.00' },
  cashbox: {
    identityNumber: 'IN-1',
    registrationNumber: 'RN-1',
    serialNumber: 'SWK00000001',
  },
  cashier: { code: 'C-1', name: 'Айжан <script>' },
  change: '50.00',
  closedAt: null,
  controlSum: 'control-'.repeat(80),
  discount: '80.00',
  documentCount: 4,
  generatedAt: '2026-08-31T08:57:06.000Z',
  markup: '0.00',
  ofd: { name: 'ОФД', website: 'https://ofd.example' },
  offline: true,
  openedAt: '2026-08-31T08:30:00.000Z',
  operations: {
    purchaseReturns: { amount: '0.00', count: 0 },
    purchases: { amount: '0.00', count: 0 },
    saleReturns: { amount: '100.00', count: 1 },
    sales: { amount: '900.00', count: 2 },
  },
  payments: [
    { amount: '100.00', providerType: 0 },
    { amount: '200.00', providerType: 1 },
    { amount: '300.00', providerType: 4 },
    { amount: '400.00', providerType: 9 },
  ],
  provider: 'WEBKASSA',
  reportNumber: '10',
  reportType: 'X',
  shiftNumber: '2',
  taken: '1050.00',
  taxpayer: { binIin: '000000000000', name: 'Demo & Co' },
  timeZone: 'Asia/Almaty',
  vat: '96.00',
};

describe('renderShiftReportDocument', () => {
  it('renders a complete escaped X report including zero rows and payment types', () => {
    const html = renderShiftReportDocument(report);

    expect(html).toContain('X-ОТЧЁТ');
    expect(html).toContain('БЕЗ ГАШЕНИЯ');
    expect(html).toContain('Demo &amp; Co');
    expect(html).toContain('Айжан &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Серийный № ККМ');
    expect(html).toContain('Идентификационный № ККМ');
    expect(html).toContain('Регистрационный № ККМ');
    expect(html).toContain('31.08.2026, 13:57');
    expect(html).toContain('Продажи (2)');
    expect(html).toContain('Покупки (0)');
    expect(html).toContain('Возвраты продаж (1)');
    expect(html).toContain('Возвраты покупок (0)');
    expect(html).toContain('Наличные');
    expect(html).toContain('Банковская карта');
    expect(html).toContain('Мобильный платёж');
    expect(html).toContain('Тип оплаты 9');
    expect(html).toContain('Внесение');
    expect(html).toContain('Изъятие');
    expect(html).toContain('Получено');
    expect(html).toContain('Сдача');
    expect(html).toContain('Скидка');
    expect(html).toContain('Наценка');
    expect(html).toContain('НДС');
    expect(html).toContain('АВТОНОМНЫЙ РЕЖИМ');
    expect(html).toContain(report.controlSum);
    expect(html).not.toMatch(/QR|credentials|raw/u);
  });

  it('renders Z closing data and omits nullable text', () => {
    const html = renderShiftReportDocument({
      ...report,
      cashier: { code: null, name: null },
      closedAt: '2026-08-31T09:00:00.000Z',
      ofd: { name: 'ОФД', website: null },
      reportType: 'Z',
      taxpayer: { binIin: null, name: null },
    });

    expect(html).toContain('Z-ОТЧЁТ');
    expect(html).toContain('С ГАШЕНИЕМ');
    expect(html).toContain('Закрытие');
    expect(html).not.toContain('Кассир');
    expect(html).not.toContain('БИН/ИИН');
    expect(html).not.toContain('https://ofd.example');
  });
});
