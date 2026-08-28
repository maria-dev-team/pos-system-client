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
  58: { columns: 32, printWidthDots: 384 },
  80: { columns: 48, printWidthDots: 576 },
} as const;

export const receiptColumnsForPaper = (
  paperWidthMm: ReceiptPaperWidthMm,
): number => receiptPaperProfiles[paperWidthMm].columns;

const characters = (value: string): string[] => [...value];

const wrapText = (value: string, width: number): string[] => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    let rest = word;
    if (
      line &&
      characters(line).length + characters(rest).length + 1 <= width
    ) {
      line += ` ${rest}`;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    while (characters(rest).length > width) {
      const chunk = characters(rest);
      lines.push(chunk.slice(0, width).join(''));
      rest = chunk.slice(width).join('');
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
};

const center = (value: string, width: number): string[] =>
  wrapText(value, width).map((line) =>
    line.padStart(
      line.length + Math.floor((width - characters(line).length) / 2),
    ),
  );

const twoColumns = (left: string, right: string, width: number): string[] => {
  const rightWidth = characters(right).length;
  if (rightWidth >= width) {
    return [...wrapText(left, width), ...wrapText(right, width)];
  }
  const leftLines = wrapText(left, width - rightWidth - 1);
  const last = leftLines.pop() ?? '';
  return [
    ...leftLines,
    `${last}${' '.repeat(width - characters(last).length - rightWidth)}${right}`,
  ];
};

const formatMoney = (value: string): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped},${fraction.padEnd(2, '0').slice(0, 2)} KZT`;
};

const formatQuantity = (value: string): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${integer},${normalizedFraction}` : integer;
};

export const renderReceiptText = (
  receipt: PrintableReceipt,
  paperWidthMm: ReceiptPaperWidthMm,
): string => {
  const width = receiptColumnsForPaper(paperWidthMm);
  const separator = '-'.repeat(width);
  const lines: string[] = [];
  const addCentered = (value: string | null): void => {
    if (value) lines.push(...center(value, width));
  };

  addCentered(receipt.organization.displayName);
  addCentered(receipt.organization.legalName);
  addCentered(
    receipt.organization.binIin
      ? `БИН/ИИН ${receipt.organization.binIin}`
      : null,
  );
  addCentered(receipt.store.name);
  addCentered(receipt.store.address);
  addCentered('НЕФИСКАЛЬНЫЙ ЧЕК');
  lines.push(separator);

  const completedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: receipt.timeZone,
  }).format(new Date(receipt.completedAt));
  lines.push(...twoColumns('Чек №', receipt.receiptNumber, width));
  lines.push(...twoColumns('Дата', completedAt, width));
  lines.push(...twoColumns('Кассир', receipt.cashier, width));
  lines.push(separator);

  for (const item of [...receipt.items].sort(
    (left, right) => left.lineNumber - right.lineNumber,
  )) {
    lines.push(...wrapText(`${item.lineNumber}. ${item.name}`, width));
    lines.push(
      ...twoColumns(
        `${formatQuantity(item.quantity)} ${item.unitLabel} x ${formatMoney(item.unitPrice)}`,
        formatMoney(item.lineTotal),
        width,
      ),
    );
  }
  lines.push(separator);

  for (const payment of receipt.payments) {
    lines.push(
      ...twoColumns(
        payment.method === 'CASH' ? 'Наличные' : 'Безналичные',
        formatMoney(payment.amount),
        width,
      ),
    );
    if (payment.received) {
      lines.push(
        ...wrapText(`Получено: ${formatMoney(payment.received)}`, width),
      );
    }
    if (payment.change) {
      lines.push(...wrapText(`Сдача: ${formatMoney(payment.change)}`, width));
    }
  }
  lines.push(separator);
  lines.push(...twoColumns('ИТОГО', formatMoney(receipt.total), width));
  lines.push(...center('НЕ ЯВЛЯЕТСЯ ФИСКАЛЬНЫМ ДОКУМЕНТОМ', width));

  return lines.join('\n');
};
