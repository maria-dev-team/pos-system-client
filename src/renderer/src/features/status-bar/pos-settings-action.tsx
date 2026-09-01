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
import { ReceiptPrinterSettingsButton } from '@renderer/features/receipt-printing';

export function PosSettingsAction() {
  const [open, setOpen] = useState(false);

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
        </DialogContent>
      </Dialog>
    </>
  );
}
