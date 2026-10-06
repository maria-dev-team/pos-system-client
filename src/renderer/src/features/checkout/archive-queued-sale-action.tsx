import { useState } from 'react';

import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { formatCash } from '@renderer/common/helpers/format-cash';

export function ArchiveQueuedSaleAction({
  busy,
  total,
  onArchive,
}: {
  busy: boolean;
  total: string;
  onArchive: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        Убрать из очереди
      </Button>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Убрать отменённый чек из очереди?</DialogTitle>
          <DialogDescription>
            Чек на {formatCash(total)} будет сохранён в локальном архиве.
            Сначала проверим сервер. Если там остался незавершённый чек,
            подтвердим его отмену. При неизвестном результате оплаты чек
            останется в очереди. Для проверки нужен интернет.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={busy}>
              Назад
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await onArchive()) setOpen(false);
            }}
          >
            {busy ? 'Проверяем чек…' : 'Подтвердить и убрать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
