export type PrintableShiftReportOperation = {
  amount: string;
  count: number;
};

export type PrintableShiftReport = {
  cash: { balance: string; deposited: string; withdrawn: string };
  cashbox: {
    identityNumber: string;
    registrationNumber: string;
    serialNumber: string;
  };
  cashier: { code: string | null; name: string | null };
  change: string;
  closedAt: string | null;
  controlSum: string;
  discount: string;
  documentCount: number;
  generatedAt: string;
  markup: string;
  ofd: { name: string; website: string | null };
  offline: boolean;
  openedAt: string;
  operations: {
    purchaseReturns: PrintableShiftReportOperation;
    purchases: PrintableShiftReportOperation;
    saleReturns: PrintableShiftReportOperation;
    sales: PrintableShiftReportOperation;
  };
  payments: { amount: string; providerType: number }[];
  provider: 'WEBKASSA';
  reportNumber: string;
  reportType: 'X' | 'Z';
  shiftNumber: string;
  taken: string;
  taxpayer: { binIin: string | null; name: string | null };
  timeZone: string;
  vat: string;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case "'":
        return '&#39;';
      default:
        return '&quot;';
    }
  });

const formatMoney = (value: string): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${fraction.padEnd(2, '0').slice(0, 2)} ₸`;
};

const line = (label: string, value: string): string =>
  `<div class="line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;

const paymentLabel = (providerType: number): string => {
  if (providerType === 0) return 'Наличные';
  if (providerType === 1) return 'Банковская карта';
  if (providerType === 4) return 'Мобильный платёж';
  return `Тип оплаты ${providerType}`;
};

const formatDate = (value: string, timeZone: string): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));

export const renderShiftReportDocument = (
  report: PrintableShiftReport,
): string => {
  const cashier = [report.cashier.name, report.cashier.code]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const operations = [
    ['Продажи', report.operations.sales],
    ['Покупки', report.operations.purchases],
    ['Возвраты продаж', report.operations.saleReturns],
    ['Возвраты покупок', report.operations.purchaseReturns],
  ] as const;

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>
      @page { margin: 0; }
      * { box-sizing: border-box; }
      html { scrollbar-width: none; }
      html::-webkit-scrollbar { display: none; }
      html, body { background: #fff; margin: 0; padding: 0; width: 100%; }
      body {
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8.5pt;
        font-weight: 400;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      strong { font-weight: inherit; }
      .center { text-align: center; }
      .title { margin: 1.5mm 0; }
      .separator { border-top: 0.25mm dashed #000; margin: 1.75mm 0; }
      .line { align-items: baseline; display: flex; gap: 1.5mm; justify-content: space-between; }
      .line span { min-width: 0; }
      .line strong { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; text-align: right; }
    </style>
  </head>
  <body>
    <header class="center">
      <div class="title">${report.reportType === 'X' ? 'X-ОТЧЁТ' : 'Z-ОТЧЁТ'}</div>
      <div>${report.reportType === 'X' ? 'БЕЗ ГАШЕНИЯ' : 'С ГАШЕНИЕМ'}</div>
      ${report.offline ? '<div>АВТОНОМНЫЙ РЕЖИМ</div>' : ''}
      ${report.taxpayer.name ? `<div>${escapeHtml(report.taxpayer.name)}</div>` : ''}
      ${report.taxpayer.binIin ? `<div>БИН/ИИН ${escapeHtml(report.taxpayer.binIin)}</div>` : ''}
    </header>
    <div class="separator"></div>
    ${line('Серийный № ККМ', report.cashbox.serialNumber)}
    ${line('Идентификационный № ККМ', report.cashbox.identityNumber)}
    ${line('Регистрационный № ККМ', report.cashbox.registrationNumber)}
    ${line('Номер отчёта', report.reportNumber)}
    ${line('Номер смены', report.shiftNumber)}
    ${line('Открытие', formatDate(report.openedAt, report.timeZone))}
    ${line('Формирование', formatDate(report.generatedAt, report.timeZone))}
    ${report.closedAt ? line('Закрытие', formatDate(report.closedAt, report.timeZone)) : ''}
    ${cashier ? line('Кассир', cashier) : ''}
    ${line('Количество документов', String(report.documentCount))}
    <div class="separator"></div>
    ${operations.map(([label, operation]) => line(`${label} (${operation.count})`, formatMoney(operation.amount))).join('\n')}
    <div class="separator"></div>
    ${report.payments.map((payment) => line(paymentLabel(payment.providerType), formatMoney(payment.amount))).join('\n')}
    <div class="separator"></div>
    ${line('Остаток наличных', formatMoney(report.cash.balance))}
    ${line('Внесение', formatMoney(report.cash.deposited))}
    ${line('Изъятие', formatMoney(report.cash.withdrawn))}
    ${line('Получено', formatMoney(report.taken))}
    ${line('Сдача', formatMoney(report.change))}
    ${line('Скидка', formatMoney(report.discount))}
    ${line('Наценка', formatMoney(report.markup))}
    ${line('НДС', formatMoney(report.vat))}
    ${report.offline ? '' : line('Режим', 'Онлайн')}
    <div class="separator"></div>
    ${line('Контрольная сумма', report.controlSum)}
    ${line('ОФД', report.ofd.name)}
    ${report.ofd.website ? `<div class="center">${escapeHtml(report.ofd.website)}</div>` : ''}
  </body>
</html>`;
};
