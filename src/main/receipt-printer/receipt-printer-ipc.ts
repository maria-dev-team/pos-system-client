import {
  BrowserWindow,
  type BrowserWindow as ElectronBrowserWindow,
  ipcMain,
} from 'electron';

import {
  MAX_RASTER_BAND_HEIGHT_DOTS,
  buildEscPosReceipt,
  encodeRasterBand,
} from './escpos-raster';
import { DefaultPrinterNotFoundError, sendRawReceipt } from './raw-printer';
import {
  type PrintableReceipt,
  type ReceiptPaperWidthMm,
  receiptPaperProfiles,
  renderReceiptDocument,
} from './receipt-document';
import {
  type PrintableShiftReport,
  renderShiftReportDocument,
} from './shift-report-document';

const GET_PRINTERS_CHANNEL = 'receipt-printer:get-printers';
const PRINT_CHANNEL = 'receipt-printer:print';
const PRINT_SHIFT_REPORT_CHANNEL = 'receipt-printer:print-shift-report';
const isCashierSafeTransportError = (error: unknown): error is Error =>
  error instanceof Error &&
  [
    'Печать ESC/POS не поддерживается этой системой.',
    'Системная очередь печати не ответила вовремя.',
    'Системная очередь печати отклонила чек.',
  ].includes(error.message);

type PrintSettings = {
  deviceName: string | null;
  paperWidthMm: ReceiptPaperWidthMm;
  rasterThreshold: 112 | 136 | 160 | 192 | 216;
};

type ReceiptPrintRequest = PrintSettings & {
  receipt: PrintableReceipt;
};

type ShiftReportPrintRequest = PrintSettings & {
  report: PrintableShiftReport;
};

type PrintResult =
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

const isNullableText = (
  value: unknown,
  maxLength = 500,
): value is string | null => value === null || isText(value, maxLength);

const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 30 &&
  /^-?\d+(?:\.\d+)?$/.test(value);

const isNonNegativeDecimal = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 30 &&
  /^\d+(?:\.\d+)?$/.test(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isPositiveIntegerText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 100 && /^[1-9]\d*$/.test(value);

const isIsoDate = (value: unknown): value is string => {
  if (!isText(value, 100)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const isReceiptItem = (value: unknown): boolean =>
  isRecord(value) &&
  isDecimal(value.discountAmount) &&
  Number.isInteger(value.lineNumber) &&
  (value.lineNumber as number) > 0 &&
  isDecimal(value.lineTotal) &&
  isDecimal(value.lineSubtotal) &&
  isNullableText(value.markingCode, 512) &&
  isText(value.name) &&
  isNullableText(value.ntinCode) &&
  isDecimal(value.quantity) &&
  isText(value.unitLabel, 20) &&
  isDecimal(value.unitPrice) &&
  isDecimal(value.vatAmount) &&
  ['NONE', '0', '5', '10', '16'].includes(String(value.vatRate));

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
  if (
    !isRecord(value.fiscal) ||
    !isRecord(value.organization) ||
    !isRecord(value.store)
  ) {
    return false;
  }
  if (!Array.isArray(value.items) || !Array.isArray(value.payments))
    return false;

  return (
    isText(value.cashier) &&
    isText(value.completedAt, 100) &&
    !Number.isNaN(Date.parse(value.completedAt)) &&
    value.currency === 'KZT' &&
    isDecimal(value.discountAmount) &&
    (value.discountPercentage === null ||
      isDecimal(value.discountPercentage)) &&
    isText(value.fiscal.address, 1000) &&
    isNullableText(value.fiscal.buyerBinIin) &&
    isText(value.fiscal.cashboxUniqueNumber) &&
    isText(value.fiscal.fiscalSign) &&
    typeof value.fiscal.offline === 'boolean' &&
    isText(value.fiscal.ofdName) &&
    isText(value.fiscal.ofdWebsite, 2000) &&
    isText(value.fiscal.qrUrl, 4000) &&
    isText(value.fiscal.receiptNumber) &&
    isText(value.fiscal.registrationNumber) &&
    isText(value.fiscal.shiftNumber) &&
    isDecimal(value.fiscal.vatTotal) &&
    typeof value.isTest === 'boolean' &&
    value.items.length > 0 &&
    value.items.length <= 500 &&
    Array.from(value.items).every(isReceiptItem) &&
    isText(value.localReceiptNumber, 100) &&
    (value.operationType === 'SALE' || value.operationType === 'RETURN') &&
    isNullableText(value.organization.binIin) &&
    isText(value.organization.displayName) &&
    isNullableText(value.organization.legalName) &&
    value.payments.length > 0 &&
    value.payments.length <= 20 &&
    Array.from(value.payments).every(isReceiptPayment) &&
    isNullableText(value.store.address) &&
    isText(value.store.name) &&
    isDecimal(value.subtotal) &&
    hasValidTimeZone(value.timeZone) &&
    isDecimal(value.total)
  );
};

const isShiftOperation = (value: unknown): boolean =>
  isRecord(value) &&
  isNonNegativeDecimal(value.amount) &&
  isNonNegativeInteger(value.count);

const isShiftPayment = (value: unknown): boolean =>
  isRecord(value) &&
  isNonNegativeDecimal(value.amount) &&
  isNonNegativeInteger(value.providerType);

const isPrintableShiftReport = (
  value: unknown,
): value is PrintableShiftReport => {
  if (!isRecord(value)) return false;
  if (
    !isRecord(value.cash) ||
    !isRecord(value.cashbox) ||
    !isRecord(value.cashier) ||
    !isRecord(value.ofd) ||
    !isRecord(value.operations) ||
    !isRecord(value.taxpayer) ||
    !Array.isArray(value.payments)
  ) {
    return false;
  }
  const closedAtValid =
    value.reportType === 'X'
      ? value.closedAt === null
      : isIsoDate(value.closedAt);

  return (
    (value.reportType === 'X' || value.reportType === 'Z') &&
    value.provider === 'WEBKASSA' &&
    isPositiveIntegerText(value.reportNumber) &&
    isPositiveIntegerText(value.shiftNumber) &&
    isIsoDate(value.generatedAt) &&
    isIsoDate(value.openedAt) &&
    closedAtValid &&
    isNullableText(value.taxpayer.name) &&
    isNullableText(value.taxpayer.binIin) &&
    isText(value.cashbox.serialNumber) &&
    isText(value.cashbox.identityNumber) &&
    isText(value.cashbox.registrationNumber) &&
    isNullableText(value.cashier.code) &&
    isNullableText(value.cashier.name) &&
    isNonNegativeInteger(value.documentCount) &&
    isNonNegativeDecimal(value.cash.balance) &&
    isNonNegativeDecimal(value.cash.deposited) &&
    isNonNegativeDecimal(value.cash.withdrawn) &&
    isShiftOperation(value.operations.sales) &&
    isShiftOperation(value.operations.purchases) &&
    isShiftOperation(value.operations.saleReturns) &&
    isShiftOperation(value.operations.purchaseReturns) &&
    value.payments.length <= 20 &&
    Array.from(value.payments).every(isShiftPayment) &&
    isNonNegativeDecimal(value.discount) &&
    isNonNegativeDecimal(value.markup) &&
    isNonNegativeDecimal(value.vat) &&
    isNonNegativeDecimal(value.change) &&
    isNonNegativeDecimal(value.taken) &&
    isText(value.controlSum, 4000) &&
    typeof value.offline === 'boolean' &&
    isText(value.ofd.name) &&
    isNullableText(value.ofd.website, 2000) &&
    hasValidTimeZone(value.timeZone)
  );
};

const hasPrintSettings = (value: Record<string, unknown>): boolean =>
  (value.deviceName === null || isText(value.deviceName, 500)) &&
  (value.paperWidthMm === 58 || value.paperWidthMm === 80) &&
  (value.rasterThreshold === 112 ||
    value.rasterThreshold === 136 ||
    value.rasterThreshold === 160 ||
    value.rasterThreshold === 192 ||
    value.rasterThreshold === 216);

const isPrintRequest = (value: unknown): value is ReceiptPrintRequest =>
  isRecord(value) &&
  hasPrintSettings(value) &&
  isPrintableReceipt(value.receipt);

const isShiftReportPrintRequest = (
  value: unknown,
): value is ShiftReportPrintRequest =>
  isRecord(value) &&
  hasPrintSettings(value) &&
  isPrintableShiftReport(value.report);

const assertSender = (
  sender: Electron.WebContents,
  mainWindow: ElectronBrowserWindow,
): void => {
  if (sender !== mainWindow.webContents) {
    throw new Error('Unauthorized receipt printer request');
  }
};

const printHtmlDocument = async (
  request: PrintSettings,
  html: string,
  documentType: 'receipt' | 'report',
): Promise<PrintResult> => {
  let printWindow: ElectronBrowserWindow | undefined;

  try {
    const profile = receiptPaperProfiles[request.paperWidthMm];
    const rasterScale = profile.printWidthDots / profile.layoutWidthCss;
    const sourceBandHeight = Math.floor(
      MAX_RASTER_BAND_HEIGHT_DOTS / rasterScale,
    );
    printWindow = new BrowserWindow({
      backgroundColor: '#ffffff',
      height: sourceBandHeight,
      show: false,
      useContentSize: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      width: profile.layoutWidthCss,
    });
    await printWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
    );
    const contentHeight = await printWindow.webContents.executeJavaScript(
      'document.fonts.ready.then(() => Math.ceil(document.documentElement.scrollHeight))',
      true,
    );
    if (
      typeof contentHeight !== 'number' ||
      !Number.isFinite(contentHeight) ||
      contentHeight <= 0
    ) {
      return {
        code: 'PRINT_FAILED',
        message:
          documentType === 'receipt'
            ? 'Не удалось определить размер чека.'
            : 'Не удалось определить размер отчёта.',
        ok: false,
      };
    }
    const contentWidth = await printWindow.webContents.executeJavaScript(
      'document.documentElement.clientWidth',
      true,
    );
    if (contentWidth !== profile.layoutWidthCss) {
      throw new Error('Invalid receipt content width');
    }

    const bands: Buffer[] = [];
    for (let y = 0; y < contentHeight; y += sourceBandHeight) {
      const sourceHeight = Math.min(sourceBandHeight, contentHeight - y);
      const actualScrollY = await printWindow.webContents.executeJavaScript(
        `new Promise((resolve) => { scrollTo(0, ${y}); requestAnimationFrame(() => resolve(window.scrollY)); })`,
        true,
      );
      if (
        typeof actualScrollY !== 'number' ||
        !Number.isFinite(actualScrollY) ||
        actualScrollY < 0 ||
        actualScrollY > y
      ) {
        throw new Error('Invalid receipt scroll position');
      }
      const captureY = y - actualScrollY;
      if (captureY + sourceHeight > sourceBandHeight) {
        throw new Error('Invalid receipt capture position');
      }
      const outputHeight =
        Math.round((y + sourceHeight) * rasterScale) -
        Math.round(y * rasterScale);
      if (outputHeight <= 0 || outputHeight > MAX_RASTER_BAND_HEIGHT_DOTS) {
        throw new Error('Invalid receipt raster height');
      }
      const captured = await printWindow.webContents.capturePage(
        {
          height: sourceHeight,
          width: profile.layoutWidthCss,
          x: 0,
          y: captureY,
        },
        { stayHidden: true },
      );
      const bitmap = captured
        .resize({ height: outputHeight, width: profile.printWidthDots })
        .toBitmap({ scaleFactor: 1 });
      bands.push(
        encodeRasterBand(
          bitmap,
          profile.printWidthDots,
          outputHeight,
          request.rasterThreshold,
        ),
      );
    }
    const encodedDocument = buildEscPosReceipt(bands);

    try {
      await sendRawReceipt(request.deviceName, encodedDocument);
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
          ? documentType === 'report'
            ? error.message.replace('чек', 'отчёт')
            : error.message
          : documentType === 'receipt'
            ? 'Не удалось напечатать чек.'
            : 'Не удалось напечатать отчёт.',
        ok: false,
      };
    }
  } catch {
    return {
      code: 'PRINT_FAILED',
      message:
        documentType === 'receipt'
          ? 'Не удалось подготовить чек для печати.'
          : 'Не удалось подготовить отчёт для печати.',
      ok: false,
    };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
  }
};

const printDocument = async (
  mainWindow: ElectronBrowserWindow,
  request: PrintSettings,
  html: string,
  documentType: 'receipt' | 'report',
): Promise<PrintResult> => {
  const printers = await mainWindow.webContents.getPrintersAsync();
  if (printers.length === 0) {
    return {
      code: 'NO_PRINTER',
      message: 'В системе не найдено ни одного принтера.',
      ok: false,
    };
  }
  if (
    request.deviceName &&
    !printers.some((printer) => printer.name === request.deviceName)
  ) {
    return {
      code: 'PRINTER_NOT_FOUND',
      message: 'Выбранный принтер недоступен.',
      ok: false,
    };
  }
  return printHtmlDocument(request, html, documentType);
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
      } satisfies PrintResult;
    }
    return printDocument(
      mainWindow,
      request,
      renderReceiptDocument(request.receipt),
      'receipt',
    );
  });

  ipcMain.handle(
    PRINT_SHIFT_REPORT_CHANNEL,
    async (event, request: unknown) => {
      assertSender(event.sender, mainWindow);
      if (!isShiftReportPrintRequest(request)) {
        return {
          code: 'PRINT_FAILED',
          message: 'Некорректные данные отчёта.',
          ok: false,
        } satisfies PrintResult;
      }
      return printDocument(
        mainWindow,
        request,
        renderShiftReportDocument(request.report),
        'report',
      );
    },
  );

  mainWindow.on('closed', () => {
    ipcMain.removeHandler(GET_PRINTERS_CHANNEL);
    ipcMain.removeHandler(PRINT_CHANNEL);
    ipcMain.removeHandler(PRINT_SHIFT_REPORT_CHANNEL);
  });
};
