import { useState } from 'react';

import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import { callLocalPos } from '@renderer/common/lib/local-pos';

import type { PosConflict } from '../../../../shared/pos/contracts';

export function LocalConflictDialog({ saleId }: { saleId: string }) {
  const [comparison, setComparison] = useState<PosConflict | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = async () => {
    setOpen(true);
    setBusy(true);
    setError(undefined);
    try {
      setComparison(
        await callLocalPos<PosConflict>({ type: 'conflict', saleId }),
      );
    } catch (e) {
      setError(getHttpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (choice: 'local' | 'server') => {
    if (!comparison) return;
    setBusy(true);
    setError(undefined);
    try {
      await callLocalPos({
        type: 'resolveConflict',
        saleId,
        choice,
        localRevision: comparison.local.local_revision!,
        serverId: comparison.remote?.id ?? null,
        serverVersion: comparison.remote?.version ?? null,
      });
      setOpen(false);
    } catch (e) {
      setError(getHttpErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="button" variant="ghost" onClick={() => void load()}>
        Сравнить версии чека
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Чек изменён на другой кассе</DialogTitle>
            <DialogDescription>
              Сравните товары и суммы перед выбором версии. Версия на кассе
              сохраняется в резервной копии.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          {comparison ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ['На этой кассе', comparison.local],
                  ['В системе', comparison.remote],
                ].map(([label, value]) => {
                  const sale = typeof value === 'object' ? value : null;
                  return (
                    <section
                      key={String(label)}
                      className="rounded-xl border p-4"
                    >
                      <h3>{String(label)}</h3>
                      {sale ? (
                        <>
                          <p className="my-2 font-bold">
                            {formatCash(sale.total)}
                          </p>
                          <ul>
                            {sale.items.map((i) => (
                              <li key={i.id}>
                                {i.name} · {i.quantity} ×{' '}
                                {formatCash(i.unit_price)}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p>Чек отсутствует</p>
                      )}
                    </section>
                  );
                })}
              </div>
              {comparison.remote &&
              comparison.remote.id !== comparison.local.id ? (
                <p>
                  При сохранении версии с этой кассы она будет отложена, а
                  выбранный чек — открыт для работы.
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button
                  disabled={
                    busy ||
                    (comparison.remote?.id === comparison.local.id &&
                      !['DRAFT', 'HELD'].includes(comparison.remote.status))
                  }
                  onClick={() => void resolve('local')}
                >
                  Сохранить версию с этой кассы
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !comparison.remote}
                  onClick={() => void resolve('server')}
                >
                  Использовать версию из системы
                </Button>
              </div>
            </>
          ) : (
            <Button disabled={busy} onClick={() => void load()}>
              {busy ? 'Загружаем версии…' : 'Повторить'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
