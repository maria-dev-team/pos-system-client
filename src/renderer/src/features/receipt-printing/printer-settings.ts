const STORAGE_KEY = 'maria.receipt-printer';

export type ReceiptPrinterSettings = {
  deviceName: string | null;
  paperWidthMm: 58 | 80;
};

export const defaultReceiptPrinterSettings: ReceiptPrinterSettings = {
  deviceName: null,
  paperWidthMm: 58,
};

const isSettings = (value: unknown): value is ReceiptPrinterSettings => {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    (settings.deviceName === null ||
      (typeof settings.deviceName === 'string' &&
        settings.deviceName.length > 0)) &&
    (settings.paperWidthMm === 58 || settings.paperWidthMm === 80)
  );
};

const migrateDotSettings = (value: unknown): ReceiptPrinterSettings | null => {
  if (typeof value !== 'object' || value === null) return null;
  const settings = value as Record<string, unknown>;
  if (
    settings.deviceName !== null &&
    (typeof settings.deviceName !== 'string' ||
      settings.deviceName.length === 0)
  ) {
    return null;
  }
  if (settings.printWidthDots !== 384 && settings.printWidthDots !== 576) {
    return null;
  }
  return {
    deviceName: settings.deviceName as string | null,
    paperWidthMm: settings.printWidthDots === 576 ? 80 : 58,
  };
};

export const readReceiptPrinterSettings = (): ReceiptPrinterSettings => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultReceiptPrinterSettings;
    const parsed: unknown = JSON.parse(stored);
    return isSettings(parsed)
      ? parsed
      : (migrateDotSettings(parsed) ?? defaultReceiptPrinterSettings);
  } catch {
    return defaultReceiptPrinterSettings;
  }
};

export const writeReceiptPrinterSettings = (
  settings: ReceiptPrinterSettings,
): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};
