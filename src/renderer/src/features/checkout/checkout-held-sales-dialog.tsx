import { LoaderCircle } from 'lucide-react';

import type { HeldSaleResponse } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { formatCash } from '@renderer/common/helpers/format-cash';

type CheckoutHeldSalesDialogProps = {
  canResume: boolean;
  error: boolean;
  heldSales: HeldSaleResponse[] | undefined;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onResume: (sale: HeldSaleResponse) => void;
  onRetry: () => void;
  open: boolean;
  pending: boolean;
};

export function CheckoutHeldSalesDialog({
  canResume,
  error,
  heldSales,
  loading,
  onOpenChange,
  onResume,
  onRetry,
  open,
  pending,
}: CheckoutHeldSalesDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Отложенные чеки</DialogTitle>
          <DialogDescription>
            Возобновить можно только в пустом окне оформления.
          </DialogDescription>
        </DialogHeader>

        {!canResume ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            Для возобновления нужен доступ и пустой чек без незавершённой
            операции.
          </p>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            Загружаем отложенные чеки
          </p>
        ) : error ? (
          <div className="space-y-3 py-4">
            <p className="text-sm font-medium text-destructive">
              Не удалось загрузить отложенные чеки.
            </p>
            <Button
              className="min-h-12"
              onClick={onRetry}
              type="button"
              variant="ghost"
            >
              Повторить
            </Button>
          </div>
        ) : heldSales?.length ? (
          <div className="max-h-[55svh] space-y-3 overflow-auto">
            {heldSales.map((sale) => (
              <article
                className="rounded-xl border border-border bg-background p-4"
                key={sale.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{sale.items_count} позиции</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(sale.held_at).toLocaleString('ru-RU')}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums text-primary">
                    {formatCash(sale.total)}
                  </p>
                </div>
                <Button
                  className="mt-3 min-h-12 w-full"
                  disabled={!canResume || pending}
                  onClick={() => onResume(sale)}
                  type="button"
                >
                  {pending ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : null}
                  Возобновить чек
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Отложенных чеков нет
          </p>
        )}

        <DialogFooter>
          <Button
            className="min-h-12"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
