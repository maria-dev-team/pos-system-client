import { type BrowserWindow as ElectronBrowserWindow, ipcMain } from 'electron';

import { buildEscPosTextReceipt } from './escpos-text';
import { DefaultPrinterNotFoundError, sendRawReceipt } from './raw-printer';
import type { PrintableReceipt, ReceiptPaperWidthMm } from './receipt-document';

const GET_PRINTERS_CHANNEL = 'receipt-printer:get-printers';
const PRINT_CHANNEL = 'receipt-printer:print';
const ENCODING_FAILURE_MESSAGE = 'Не удалось подготовить чек для печати.';
const isCashierSafeTransportError = (error: unknown): error is Error =>
  error instanceof Error &&
  [
    'Печать ESC/POS не поддерживается этой системой.',
    'Системная очередь печати не ответила вовремя.',
    'Системная очередь печати отклонила чек.',
  ].includes(error.message);

type ReceiptPrintRequest = {
  deviceName: string | null;
  paperWidthMm: ReceiptPaperWidthMm;
  receipt: PrintableReceipt;
};

type ReceiptPrintResult =
  | { ok: true }
  | {
      code: 'NO_PRINTER' | 'PRINTER_NOT_FOUND' | 'PRINT_FAILED';
      message: string;
      ok: false;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isText = (value: unknown, maxLength = 500): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength;

const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);

const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 30 &&
  /^-?\d+(?:\.\d+)?$/.test(value);

const isReceiptItem = (value: unknown): boolean =>
  isRecord(value) &&
  Number.isInteger(value.lineNumber) &&
  (value.lineNumber as number) > 0 &&
  isDecimal(value.lineTotal) &&
  isText(value.name) &&
  isDecimal(value.quantity) &&
  isText(value.unitLabel, 20) &&
  isDecimal(value.unitPrice);

const isReceiptPayment = (value: unknown): boolean =>
  isRecord(value) &&
  isDecimal(value.amount) &&
  isNullableText(value.change) &&
  (value.change === null || isDecimal(value.change)) &&
  (value.method === 'CASH' || value.method === 'CASHLESS') &&
  isNullableText(value.received) &&
  (value.received === null || isDecimal(value.received));

const hasValidTimeZone = (value: unknown): value is string => {
  if (!isText(value, 100)) return false;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const isPrintableReceipt = (value: unknown): value is PrintableReceipt => {
  if (!isRecord(value)) return false;
  if (!isRecord(value.organization) || !isRecord(value.store)) return false;
  if (!Array.isArray(value.items) || !Array.isArray(value.payments))
    return false;

  return (
    isText(value.cashier) &&
    isText(value.completedAt, 100) &&
    !Number.isNaN(Date.parse(value.completedAt)) &&
    value.currency === 'KZT' &&
    value.items.length > 0 &&
    value.items.length <= 500 &&
    Array.from(value.items).every(isReceiptItem) &&
    isNullableText(value.organization.binIin) &&
    isText(value.organization.displayName) &&
    isNullableText(value.organization.legalName) &&
    value.payments.length > 0 &&
    value.payments.length <= 20 &&
    Array.from(value.payments).every(isReceiptPayment) &&
    isText(value.receiptNumber, 100) &&
    isNullableText(value.store.address) &&
    isText(value.store.name) &&
    hasValidTimeZone(value.timeZone) &&
    isDecimal(value.total)
  );
};

const isPrintRequest = (value: unknown): value is ReceiptPrintRequest =>
  isRecord(value) &&
  (value.deviceName === null || isText(value.deviceName, 500)) &&
  (value.paperWidthMm === 58 || value.paperWidthMm === 80) &&
  isPrintableReceipt(value.receipt);

const assertSender = (
  sender: Electron.WebContents,
  mainWindow: ElectronBrowserWindow,
): void => {
  if (sender !== mainWindow.webContents) {
    throw new Error('Unauthorized receipt printer request');
  }
};

const printReceipt = async (
  request: ReceiptPrintRequest,
): Promise<ReceiptPrintResult> => {
  let encodedReceipt: Buffer;
  try {
    encodedReceipt = buildEscPosTextReceipt(
      request.receipt,
      request.paperWidthMm,
    );
  } catch {
    return {
      code: 'PRINT_FAILED',
      message: ENCODING_FAILURE_MESSAGE,
      ok: false,
    };
  }

  try {
    await sendRawReceipt(request.deviceName, encodedReceipt);
    return { ok: true };
  } catch (error) {
    if (error instanceof DefaultPrinterNotFoundError) {
      return {
        code: 'PRINTER_NOT_FOUND',
        message: 'Системный принтер по умолчанию не настроен.',
        ok: false,
      };
    }
    return {
      code: 'PRINT_FAILED',
      message: isCashierSafeTransportError(error)
        ? error.message
        : 'Не удалось напечатать чек.',
      ok: false,
    };
  }
};

export const registerReceiptPrinterIpc = (
  mainWindow: ElectronBrowserWindow,
): void => {
  ipcMain.handle(GET_PRINTERS_CHANNEL, async (event) => {
    assertSender(event.sender, mainWindow);
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(({ description, displayName, name }) => ({
      description,
      displayName,
      name,
    }));
  });

  ipcMain.handle(PRINT_CHANNEL, async (event, request: unknown) => {
    assertSender(event.sender, mainWindow);
    if (!isPrintRequest(request)) {
      return {
        code: 'PRINT_FAILED',
        message: 'Некорректные данные чека.',
        ok: false,
      } satisfies ReceiptPrintResult;
    }

    const printers = await mainWindow.webContents.getPrintersAsync();
    if (printers.length === 0) {
      return {
        code: 'NO_PRINTER',
        message: 'В системе не найдено ни одного принтера.',
        ok: false,
      } satisfies ReceiptPrintResult;
    }
    if (
      request.deviceName &&
      !printers.some((printer) => printer.name === request.deviceName)
    ) {
      return {
        code: 'PRINTER_NOT_FOUND',
        message: 'Выбранный принтер недоступен.',
        ok: false,
      } satisfies ReceiptPrintResult;
    }

    return printReceipt(request);
  });

  mainWindow.on('closed', () => {
    ipcMain.removeHandler(GET_PRINTERS_CHANNEL);
    ipcMain.removeHandler(PRINT_CHANNEL);
  });
};
