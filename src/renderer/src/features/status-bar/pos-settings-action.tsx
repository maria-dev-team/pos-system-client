import { Settings } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { callLocalPos } from '@renderer/common/lib/local-pos';
import { ReceiptPrinterSettingsButton } from '@renderer/features/receipt-printing';

import type { PosDiagnostics } from '../../../../shared/pos/contracts';

export function PosSettingsAction() {
  const [diagnostics, setDiagnostics] = useState<PosDiagnostics>();
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <>
      <Button
        aria-label="Настройки приложения"
        className="min-h-12 min-w-12 px-3"
        onClick={() => setOpen(true)}
        title="Настройки"
        type="button"
        variant="ghost"
      >
        <Settings aria-hidden="true" />
      </Button>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Настройки приложения</DialogTitle>
            <DialogDescription>
              Параметры оборудования и рабочего места.
            </DialogDescription>
          </DialogHeader>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Оборудование
            </p>
            <ReceiptPrinterSettingsButton className="min-h-13 w-full justify-start border-border bg-background px-4" />
          </section>
          {window.localPos ? (
            <section>
              <Button
                variant="ghost"
                onClick={() => {
                  void callLocalPos<PosDiagnostics>({ type: 'diagnostics' })
                    .then(setDiagnostics)
                    .catch(() =>
                      setError(
                        'Диагностика недоступна. Восстановите локальный модуль.',
                      ),
                    );
                }}
              >
                Диагностика кассы
              </Button>
              {diagnostics ? (
                <p className="text-sm">
                  Очередь: {diagnostics.workingReceipts}; история:{' '}
                  {diagnostics.historyReceipts}. База:{' '}
                  {(diagnostics.databaseBytes / 1048576).toFixed(1)} МБ; память:{' '}
                  {(diagnostics.heapBytes / 1048576).toFixed(1)} МБ. Свободно на
                  диске:{' '}
                  {diagnostics.freeDiskBytes === null
                    ? 'неизвестно'
                    : `${(diagnostics.freeDiskBytes / 1073741824).toFixed(1)} ГБ`}
                  .
                  {diagnostics.freeDiskBytes !== null &&
                  diagnostics.freeDiskBytes < 1073741824
                    ? ' Мало места. Освободите диск, сохранив данные POS.'
                    : ''}
                </p>
              ) : null}
              <Button
                variant="ghost"
                disabled={restarting}
                onClick={() => {
                  setRestarting(true);
                  setError(undefined);
                  void callLocalPos({ type: 'restartWorker' })
                    .then(() => window.location.reload())
                    .catch(() => {
                      setError(
                        'Не удалось восстановить локальный модуль. Перезапустите приложение; не удаляйте данные кассы.',
                      );
                      setRestarting(false);
                    });
                }}
              >
                Восстановить локальный модуль
              </Button>
              <p className="text-sm text-muted-foreground">
                Сохранённые чеки будут восстановлены. Неподтверждённые оплаты
                потребуют проверки.
              </p>
              {error ? <p role="alert">{error}</p> : null}
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
