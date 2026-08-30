import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type {
  AuthContextResponse,
  CashierSessionResponse,
  ReceiptResponse,
  SaleResponse,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Label } from '@renderer/common/components/ui/label';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import { currentUserQueryOptions } from '@renderer/features/user';

import {
  receiptPaperProfiles,
  renderReceiptDocument,
} from '../../../../main/receipt-printer/receipt-document';
import {
  readReceiptPrinterSettings,
  writeReceiptPrinterSettings,
} from './printer-settings';
import { buildPrintableReceipt } from './receipt-data';

type PrinterInfo = Awaited<
  ReturnType<NonNullable<Window['receiptPrinter']>['getPrinters']>
>[number];

const testReceipt: Parameters<
  NonNullable<Window['receiptPrinter']>['print']
>[0]['receipt'] = {
  cashier: 'Ә Ғ Қ Ң Ө Ұ Ү Һ І',
  completedAt: '2026-01-01T00:00:00.000Z',
  currency: 'KZT',
  fiscal: {
    address: 'Тестовый адрес',
    buyerBinIin: null,
    cashboxUniqueNumber: 'TEST-CASHBOX',
    fiscalSign: 'TEST-FISCAL-SIGN',
    offline: false,
    ofdName: 'Тестовый ОФД',
    ofdWebsite: 'https://ofd.example',
    qrUrl: 'https://ofd.example/test-check',
    receiptNumber: '1',
    registrationNumber: 'TEST-REGISTRATION',
    shiftNumber: '1',
    vatTotal: '0.00',
  },
  isTest: true,
  items: [
    {
      lineNumber: 1,
      lineTotal: '100.00',
      markingCode: null,
      name: 'Тестовая печать: длинное название товара',
      ntinCode: 'TEST-NTIN',
      quantity: '1',
      unitLabel: 'шт.',
      unitPrice: '100.00',
      vatAmount: '0.00',
      vatRate: 'NONE',
    },
  ],
  localReceiptNumber: 'TEST',
  operationType: 'SALE',
  organization: {
    binIin: null,
    displayName: 'Maria POS',
    legalName: null,
  },
  payments: [
    {
      amount: '100.00',
      change: null,
      method: 'CASHLESS',
      received: null,
    },
  ],
  store: { address: null, name: 'Проверка принтера' },
  timeZone: 'Asia/Almaty',
  total: '100.00',
};

function ReceiptPrinterSettingsDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [initialSettings] = useState(readReceiptPrinterSettings);
  const [deviceName, setDeviceName] = useState(
    initialSettings.deviceName ?? '',
  );
  const [paperWidthMm, setPaperWidthMm] = useState(
    initialSettings.paperWidthMm,
  );
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string>();
  const [previewReceipt, setPreviewReceipt] = useState<typeof testReceipt>();

  const loadPrinters = async () => {
    const bridge = window.receiptPrinter;
    if (!bridge) {
      setError('Печать недоступна в этом окружении.');
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const nextPrinters = await bridge.getPrinters();
      setPrinters(nextPrinters);
      if (
        deviceName &&
        !nextPrinters.some((printer) => printer.name === deviceName)
      ) {
        setDeviceName('');
        setError('Сохранённый принтер недоступен.');
      }
    } catch {
      setError('Не удалось получить список принтеров.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const bridge = window.receiptPrinter;
    if (!bridge) return;
    void bridge
      .getPrinters()
      .then((nextPrinters) => {
        setPrinters(nextPrinters);
        if (
          initialSettings.deviceName &&
          !nextPrinters.some(
            (printer) => printer.name === initialSettings.deviceName,
          )
        ) {
          setDeviceName('');
          setError('Сохранённый принтер недоступен.');
        }
      })
      .catch(() => setError('Не удалось получить список принтеров.'));
  }, [initialSettings.deviceName, open]);

  const currentSettings = () => ({
    deviceName: deviceName || null,
    paperWidthMm,
    rasterThreshold: initialSettings.rasterThreshold,
  });
  const save = () => {
    if (!writeReceiptPrinterSettings(currentSettings())) {
      setError('Не удалось сохранить настройки принтера.');
      return;
    }
    toast.success('Настройки принтера сохранены');
    onOpenChange(false);
  };
  const previewTest = () => {
    if (!window.receiptPrinter) {
      setError('Печать недоступна в этом окружении.');
      return;
    }
    setError(undefined);
    setPreviewReceipt({
      ...testReceipt,
      completedAt: new Date().toISOString(),
    });
  };
  const printTest = async () => {
    const bridge = window.receiptPrinter;
    if (!bridge || !previewReceipt) {
      setError('Печать недоступна в этом окружении.');
      return;
    }
    setIsTesting(true);
    setError(undefined);
    try {
      const result = await bridge.print({
        ...currentSettings(),
        receipt: previewReceipt,
      });
      if (result.ok) {
        toast.success('Тестовый чек отправлен на принтер');
        setPreviewReceipt(undefined);
      } else {
        setError(result.message);
      }
    } catch {
      setError('Не удалось отправить тестовый чек.');
    } finally {
      setIsTesting(false);
    }
  };

  const selectedPrinter = printers.find(
    (printer) => printer.name === deviceName,
  );

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Принтер чека</DialogTitle>
            <DialogDescription>
              Выберите системный принтер и ширину установленного рулона.
            </DialogDescription>
          </DialogHeader>
          <FormField>
            <Label htmlFor="receipt-printer-device">Принтер</Label>
            <select
              className="h-12 w-full rounded-lg border border-input bg-background px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
              id="receipt-printer-device"
              onChange={(event) => setDeviceName(event.target.value)}
              value={deviceName}
            >
              <option value="">Системный по умолчанию</option>
              {printers.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.displayName || printer.name}
                </option>
              ))}
            </select>
            {selectedPrinter?.description ? (
              <p className="text-xs text-muted-foreground">
                {selectedPrinter.description}
              </p>
            ) : null}
          </FormField>
          <FormField>
            <Label htmlFor="receipt-printer-width">Ширина бумаги</Label>
            <select
              className="h-12 w-full rounded-lg border border-input bg-background px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
              id="receipt-printer-width"
              onChange={(event) =>
                setPaperWidthMm(Number(event.target.value) as 58 | 80)
              }
              value={paperWidthMm}
            >
              <option value="58">58 мм</option>
              <option value="80">80 мм</option>
            </select>
          </FormField>
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            disabled={isLoading}
            onClick={() => void loadPrinters()}
            type="button"
            variant="ghost"
          >
            {isLoading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Обновить список
          </Button>
          <DialogFooter>
            <Button onClick={previewTest} type="button" variant="ghost">
              <Printer aria-hidden="true" />
              Тестовая печать
            </Button>
            <Button onClick={save} type="button">
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {previewReceipt ? (
        <Dialog
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPreviewReceipt(undefined);
          }}
          open
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Предпросмотр тестового чека</DialogTitle>
              <DialogDescription>
                Ширина бумаги: {paperWidthMm} мм. Ниже показан документ, который
                будет преобразован в растр.
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[65vh] justify-center overflow-auto rounded-xl bg-muted p-4">
              <iframe
                className="h-[60vh] shrink-0 border-0 bg-white shadow-sm"
                sandbox=""
                srcDoc={renderReceiptDocument(previewReceipt)}
                style={{
                  width: `${receiptPaperProfiles[paperWidthMm].layoutWidthCss}px`,
                }}
                title="Содержимое тестового чека"
              />
            </div>
            {error ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={isTesting}
                onClick={() => setPreviewReceipt(undefined)}
                type="button"
                variant="ghost"
              >
                Назад
              </Button>
              <Button
                disabled={isTesting}
                onClick={() => void printTest()}
                type="button"
              >
                {isTesting ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Printer aria-hidden="true" />
                )}
                Печатать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function ReceiptPrinterSettingsButton({
  className,
  labelClassName,
}: {
  className?: string;
  labelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className={className}
        onClick={() => setOpen(true)}
        type="button"
        variant="ghost"
      >
        <Printer aria-hidden="true" />
        <span className={labelClassName}>Настроить принтер</span>
      </Button>
      {open ? (
        <ReceiptPrinterSettingsDialog onOpenChange={setOpen} open />
      ) : null}
    </>
  );
}

export function ReceiptPrintButton({
  cashierSession,
  className,
  context,
  sale,
}: {
  cashierSession: CashierSessionResponse;
  className?: string;
  context: AuthContextResponse;
  sale: SaleResponse | ReceiptResponse;
}) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const user = useQuery(currentUserQueryOptions());
  const organizations = useQuery(organizationsQueryOptions());
  const organization = organizations.data?.find(
    (membership) => membership.organization?.id === sale.organization_id,
  )?.organization;
  const store = context.storeScope.stores.find(
    (candidate) => candidate.id === sale.store_id,
  );
  const cashierName = user.data
    ? [user.data.first_name, user.data.last_name].filter(Boolean).join(' ') ||
      user.data.email
    : null;

  const print = async () => {
    const bridge = window.receiptPrinter;
    if (!bridge) {
      toast.error('Печать недоступна в этом окружении.');
      return;
    }
    const historicalCashierName =
      'cashier_name' in sale ? sale.cashier_name : undefined;
    if (historicalCashierName === null) {
      toast.error('У кассира не заполнено имя');
      return;
    }
    const receipt = buildPrintableReceipt(sale, {
      cashierName: historicalCashierName,
      currentCashier: cashierName
        ? { id: cashierSession.membership_id, name: cashierName }
        : null,
      organization,
      store,
    });
    if (!receipt) {
      toast.error('Данные этого чека нельзя напечатать.');
      return;
    }

    setIsPrinting(true);
    try {
      const result = await bridge.print({
        ...readReceiptPrinterSettings(),
        receipt,
      });
      if (result.ok) {
        toast.success('Чек отправлен на принтер');
      } else {
        toast.error(result.message);
        if (
          result.code === 'NO_PRINTER' ||
          result.code === 'PRINTER_NOT_FOUND'
        ) {
          setSettingsOpen(true);
        }
      }
    } catch {
      toast.error('Не удалось отправить чек на печать.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <>
      <Button
        className={className}
        disabled={isPrinting}
        onClick={() => void print()}
        type="button"
        variant="ghost"
      >
        {isPrinting ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Printer aria-hidden="true" />
        )}
        Печать чека
      </Button>
      {settingsOpen ? (
        <ReceiptPrinterSettingsDialog onOpenChange={setSettingsOpen} open />
      ) : null}
    </>
  );
}
