import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle } from 'lucide-react';

import type { CashierSessionResponse } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';

import { useCashMovements } from './use-cash-movements';

export function CashMovementsDialog({
  session,
  initialType,
  onClose,
}: {
  session: CashierSessionResponse;
  initialType: 'DEPOSIT' | 'WITHDRAWAL';
  onClose: () => void;
}) {
  const flow = useCashMovements(session, initialType);
  const locked = flow.busy || Boolean(flow.pending) || flow.blocked;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !flow.busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden sm:max-w-2xl"
        showCloseButton={!flow.busy}
      >
        <DialogHeader>
          <DialogTitle>Наличные в кассе</DialogTitle>
          <DialogDescription>
            Внесение и изъятие учитываются в остатке и при закрытии смены. Для
            подтверждения нужно подключение к серверу.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          {flow.list.data ? (
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">
                Ожидаемый остаток смены кассира
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {formatCash(flow.list.data.balance)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Внесено: {formatCash(flow.list.data.deposited)} · Изъято:{' '}
                {formatCash(flow.list.data.withdrawn)}
              </p>
            </div>
          ) : flow.list.isError ? (
            <div role="alert" className="text-sm text-destructive">
              {getHttpErrorMessage(
                flow.list.error,
                'Не удалось загрузить остаток и историю.',
              )}
              <Button variant="ghost" onClick={() => void flow.list.refetch()}>
                Обновить остаток
              </Button>
            </div>
          ) : (
            <p role="status">Загружаем остаток…</p>
          )}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void flow.confirm();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={flow.type === 'DEPOSIT' ? 'default' : 'ghost'}
                disabled={locked}
                aria-pressed={flow.type === 'DEPOSIT'}
                onClick={() => flow.setType('DEPOSIT')}
              >
                <ArrowDownToLine />
                Внесение
              </Button>
              <Button
                type="button"
                variant={flow.type === 'WITHDRAWAL' ? 'default' : 'ghost'}
                disabled={locked}
                aria-pressed={flow.type === 'WITHDRAWAL'}
                onClick={() => flow.setType('WITHDRAWAL')}
              >
                <ArrowUpFromLine />
                Изъятие
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-movement-amount">Сумма, ₸</Label>
              <Input
                id="cash-movement-amount"
                inputMode="decimal"
                maxLength={20}
                disabled={locked}
                value={flow.amount}
                onChange={(event) => flow.setAmount(event.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-movement-reason">Причина</Label>
              <Input
                id="cash-movement-reason"
                maxLength={500}
                disabled={locked}
                value={flow.reason}
                onChange={(event) => flow.setReason(event.target.value)}
                placeholder={
                  flow.type === 'DEPOSIT'
                    ? 'Например, разменные деньги'
                    : 'Например, инкассация'
                }
              />
            </div>
            {flow.error ? (
              <p role="alert" className="text-sm text-destructive">
                {flow.error}
              </p>
            ) : null}
            {flow.success ? (
              <p role="status" className="text-sm font-semibold text-primary">
                {flow.success}
              </p>
            ) : null}
            {flow.pending && !flow.busy ? (
              <p className="text-sm text-muted-foreground">
                Сохранена неподтверждённая операция. Повторная проверка
                использует тот же номер и не создаёт вторую операцию.
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={flow.busy || flow.blocked}
              type="submit"
            >
              {flow.busy ? <LoaderCircle className="animate-spin" /> : null}
              {flow.pending
                ? 'Повторить проверку операции'
                : flow.type === 'DEPOSIT'
                  ? 'Внести деньги'
                  : 'Изъять деньги'}
            </Button>
          </form>
          <section
            className="space-y-3 border-t border-border pt-4"
            aria-label="История денежных операций"
          >
            <h2 className="font-semibold">Операции текущей смены</h2>
            {flow.list.data?.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Операций пока нет.
              </p>
            ) : null}
            {flow.list.data?.movements.map((movement) => (
              <article
                key={movement.id}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold">
                    {movement.type === 'DEPOSIT' ? 'Внесение' : 'Изъятие'}
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {movement.type === 'DEPOSIT' ? '+' : '−'}
                    {formatCash(movement.amount)}
                  </span>
                </div>
                <p className="break-words text-sm">{movement.reason}</p>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={movement.created_at}
                >
                  {new Date(movement.created_at).toLocaleString('ru-RU')}
                </time>
              </article>
            ))}
            {flow.list.data &&
            (flow.offset > 0 || flow.list.data.meta.has_more) ? (
              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  disabled={flow.offset === 0 || flow.busy}
                  onClick={() => flow.setOffset(Math.max(0, flow.offset - 20))}
                >
                  Назад
                </Button>
                <Button
                  variant="ghost"
                  disabled={!flow.list.data.meta.has_more || flow.busy}
                  onClick={() => flow.setOffset(flow.offset + 20)}
                >
                  Далее
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
