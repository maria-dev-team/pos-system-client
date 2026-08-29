export type PrintableReceiptItem = {
  lineNumber: number;
  lineTotal: string;
  name: string;
  quantity: string;
  unitLabel: string;
  unitPrice: string;
};

export type PrintableReceiptPayment = {
  amount: string;
  change: string | null;
  method: 'CASH' | 'CASHLESS';
  received: string | null;
};

export type PrintableReceipt = {
  cashier: string;
  completedAt: string;
  currency: 'KZT';
  items: PrintableReceiptItem[];
  organization: {
    binIin: string | null;
    displayName: string;
    legalName: string | null;
  };
  payments: PrintableReceiptPayment[];
  receiptNumber: string;
  store: { address: string | null; name: string };
  timeZone: string;
  total: string;
};

export type ReceiptPaperWidthMm = 58 | 80;

export const receiptPaperProfiles = {
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
} as const;

const formatMoney = (value: string): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped},${fraction.padEnd(2, '0').slice(0, 2)} ₸`;
};

const formatQuantity = (value: string): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${integer},${normalizedFraction}` : integer;
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

const receiptLine = (label: string, value: string): string =>
  `<div class="meta"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;

export const renderReceiptDocument = (receipt: PrintableReceipt): string => {
  const organizationDetails = [
    receipt.organization.legalName,
    receipt.organization.binIin
      ? `БИН/ИИН ${receipt.organization.binIin}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => `<div>${escapeHtml(value)}</div>`)
    .join('');
  const items = [...receipt.items]
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .map(
      (item) => `<section class="item">
        <div class="item-name">${item.lineNumber}. ${escapeHtml(item.name)}</div>
        <div class="item-totals">
          <span>${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unitLabel)} × ${escapeHtml(formatMoney(item.unitPrice))}</span>
          <strong>${escapeHtml(formatMoney(item.lineTotal))}</strong>
        </div>
      </section>`,
    )
    .join('');
  const payments = receipt.payments
    .map((payment) => {
      const details = [
        payment.received
          ? `<div>Получено: ${escapeHtml(formatMoney(payment.received))}</div>`
          : '',
        payment.change
          ? `<div>Сдача: ${escapeHtml(formatMoney(payment.change))}</div>`
          : '',
      ].join('');
      return `<section class="payment">
        <div class="payment-total"><span>${payment.method === 'CASH' ? 'Наличные' : 'Безналичные'}</span><strong>${escapeHtml(formatMoney(payment.amount))}</strong></div>
        ${details}
      </section>`;
    })
    .join('');
  const completedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: receipt.timeZone,
  }).format(new Date(receipt.completedAt));

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
        padding: 0;
      }
      strong { font-weight: inherit; }
      .center { text-align: center; }
      .separator { border-top: 0.25mm dashed #000; margin: 1.75mm 0; }
      .meta, .item-totals, .payment-total, .grand-total {
        align-items: baseline;
        display: flex;
        gap: 1.5mm;
        justify-content: space-between;
      }
      .meta span, .item-totals span, .payment-total span { min-width: 0; }
      .meta strong, .item-totals strong, .payment-total strong, .grand-total strong {
        flex: 0 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: right;
      }
    </style>
  </head>
  <body>
    <header class="center">
      <div>${escapeHtml(receipt.organization.displayName)}</div>
      ${organizationDetails}
      <div>${escapeHtml(receipt.store.name)}</div>
      ${receipt.store.address ? `<div>${escapeHtml(receipt.store.address)}</div>` : ''}
      <div class="title">НЕФИСКАЛЬНЫЙ ЧЕК</div>
    </header>
    <div class="separator"></div>
    ${receiptLine('Чек №', receipt.receiptNumber)}
    ${receiptLine('Дата', completedAt)}
    ${receiptLine('Кассир', receipt.cashier)}
    <div class="separator"></div>
    ${items}
    <div class="separator"></div>
    ${payments}
    <div class="separator"></div>
    <div class="grand-total"><span>ИТОГО</span><strong>${escapeHtml(formatMoney(receipt.total))}</strong></div>
    <div class="center notice">НЕ ЯВЛЯЕТСЯ ФИСКАЛЬНЫМ ДОКУМЕНТОМ</div>
  </body>
</html>`;
};
