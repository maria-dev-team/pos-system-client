import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LoaderCircle, ReceiptText } from 'lucide-react';
import { useState } from 'react';

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
import { cn } from '@renderer/common/lib/utils';

import { formatQuantity } from './checkout-input';
import { saleDetailsQueryOptions } from './checkout-query-options';

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

type HeldSaleCardProps = {
  canResume: boolean;
  expanded: boolean;
  onExpandChange: (expanded: boolean) => void;
  onResume: (sale: HeldSaleResponse) => void;
  pending: boolean;
  sale: HeldSaleResponse;
};

function formatPositionsCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} позиций`;
  if (lastDigit === 1) return `${count} позиция`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} позиции`;
  return `${count} позиций`;
}

function HeldSaleCard({
  canResume,
  expanded,
  onExpandChange,
  onResume,
  pending,
  sale,
}: HeldSaleCardProps) {
  const detailsId = `held-sale-${sale.id}-details`;
  const details = useQuery({
    ...saleDetailsQueryOptions(sale.id),
    enabled: expanded,
  });

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background">
      <button
        aria-controls={detailsId}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Скрыть' : 'Показать'} товары чека: ${formatPositionsCount(sale.items_count)}, ${formatCash(sale.total)}`}
        className="flex w-full items-center justify-between gap-4 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35"
        onClick={() => onExpandChange(!expanded)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block font-semibold text-foreground">
            {formatPositionsCount(sale.items_count)}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Отложен {new Date(sale.held_at).toLocaleString('ru-RU')}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-bold tabular-nums text-primary">
            {formatCash(sale.total)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-5 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </span>
      </button>

      {expanded ? (
        <div
          aria-label={`Товары в чеке на сумму ${formatCash(sale.total)}`}
          className="border-t border-border"
          id={detailsId}
          role="region"
        >
          {details.isPending ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              Загружаем товары
            </p>
          ) : details.isError ? (
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm font-medium text-destructive">
                Не удалось загрузить товары чека.
              </p>
              <Button
                className="min-h-10"
                onClick={() => void details.refetch()}
                type="button"
                variant="ghost"
              >
                Повторить
              </Button>
            </div>
          ) : details.data.items.length ? (
            <ul className="divide-y divide-border px-4">
              {details.data.items.map((item) => (
                <li
                  className="flex items-start justify-between gap-4 py-3"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {formatQuantity(item.quantity, item.unit_code)} ×{' '}
                      {formatCash(item.unit_price)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatCash(item.line_total)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              В чеке нет товаров
            </p>
          )}
        </div>
      ) : null}

      <div className="border-t border-border p-4">
        <Button
          className="min-h-12 w-full"
          disabled={!canResume || pending}
          onClick={() => onResume(sale)}
          type="button"
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Возобновить чек
        </Button>
      </div>
    </article>
  );
}

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
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const changeOpen = (nextOpen: boolean) => {
    if (pending) return;
    if (!nextOpen) setExpandedSaleId(null);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Отложенные чеки</DialogTitle>
          <DialogDescription>
            Вернитесь к продаже, которую отложили ранее
          </DialogDescription>
        </DialogHeader>

        {!canResume ? (
          <p className="rounded-xl bg-warning-muted px-4 py-3 text-sm text-warning">
            Сначала завершите или очистите текущий чек
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
              <HeldSaleCard
                canResume={canResume}
                expanded={expandedSaleId === sale.id}
                key={sale.id}
                onExpandChange={(expanded) =>
                  setExpandedSaleId(expanded ? sale.id : null)
                }
                onResume={onResume}
                pending={pending}
                sale={sale}
              />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
              <ReceiptText aria-hidden="true" className="size-6" />
            </span>
            <p className="mt-3 font-semibold text-foreground">
              Нет отложенных чеков
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Отложенные продажи появятся здесь
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-center">
          <Button
            className="min-h-12 w-full border-border bg-background"
            disabled={pending}
            onClick={() => changeOpen(false)}
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
