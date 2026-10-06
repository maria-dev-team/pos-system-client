import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  AuthContextResponse,
  CashierSessionResponse,
  SaleResponse,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { callLocalPos, localPosActive } from '@renderer/common/lib/local-pos';
import { ReceiptPrintButton } from '@renderer/features/receipt-printing';
import { useReceiptMetadata } from '@renderer/features/receipt-printing';

export function LocalReceiptsButton({
  context,
  cashierSession,
}: {
  context: AuthContextResponse;
  cashierSession: CashierSessionResponse;
}) {
  useReceiptMetadata(context, cashierSession);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const receipts = useQuery({
    queryKey: ['local-non-fiscal-receipts', cashierSession.id, offset],
    queryFn: () =>
      callLocalPos<SaleResponse[]>({ type: 'localReceipts', offset }),
    enabled: open && localPosActive(),
    networkMode: 'always',
    staleTime: 0,
  });
  if (!localPosActive()) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-8 w-fit shrink-0 px-2 py-1 text-xs font-medium"
        onClick={() => {
          setOffset(0);
          setOpen(true);
        }}
      >
        Локальные чеки
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Нефискальные чеки этой смены</DialogTitle>
            <DialogDescription>
              Сохранены на этой кассе. Повторная печать доступна без интернета.
            </DialogDescription>
          </DialogHeader>
          {receipts.isPending ? (
            <p>Загрузка чеков…</p>
          ) : receipts.isError ? (
            <p role="alert">Не удалось прочитать локальные чеки.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-auto">
              {receipts.data?.length ? (
                receipts.data.map((sale) => (
                  <div key={sale.id} className="rounded-lg border p-3">
                    <p>
                      {formatCash(sale.total)} ·{' '}
                      {new Date(sale.completed_at!).toLocaleString('ru-RU')}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {sale.receipt_number}
                    </p>
                    <ReceiptPrintButton
                      sale={sale}
                      context={context}
                      cashierSession={cashierSession}
                    />
                  </div>
                ))
              ) : (
                <p>Нефискальных чеков пока нет.</p>
              )}
            </div>
          )}
          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Назад
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={receipts.data?.length !== 25}
              onClick={() => setOffset(offset + 25)}
            >
              Далее
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
