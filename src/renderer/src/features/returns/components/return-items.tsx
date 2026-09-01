import Decimal from 'decimal.js';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type {
  ProductUnit,
  ReceiptResponse,
  ReturnDisposition,
} from '@renderer/common/api';
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
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { parseGs1DataMatrix } from '@renderer/common/lib/gs1-data-matrix';
import {
  adjustQuantityByOne,
  formatQuantity,
  quantitySchema,
} from '@renderer/common/lib/quantity';

import {
  calculateReceiptReturnLineTotal,
  getReturnUnitPrice,
} from '../returns-calculations';
import { returnQuantitySchema } from '../returns.schema';
import type { ReceiptSelection, WithoutReceiptLine } from '../returns.types';

const dispositionOptions = [
  { label: 'На склад', value: 'RESTOCK' },
  { label: 'Списать', value: 'WRITE_OFF' },
] as const;

function initialReceiptQuantity(returnableQuantity: string) {
  return new Decimal(returnableQuantity).lt(1) ? returnableQuantity : '1';
}

function parseDecimal(value: string) {
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

function QuantityControl({
  controlId,
  disabled = false,
  maxQuantity,
  name,
  onChange,
  tableLayout = false,
  unit,
  value,
}: {
  controlId: string;
  disabled?: boolean;
  maxQuantity?: string;
  name: string;
  onChange: (value: string) => void;
  tableLayout?: boolean;
  unit: ProductUnit;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const parsedValue = parseDecimal(value);
  const canDecrease = Boolean(parsedValue?.gt(1));
  const canIncrease = maxQuantity
    ? Boolean(parsedValue?.lt(new Decimal(maxQuantity)))
    : true;

  const adjust = (delta: -1 | 1) => {
    const next = adjustQuantityByOne(value, delta);
    if (!next) return;
    if (maxQuantity && new Decimal(next).gt(new Decimal(maxQuantity))) {
      onChange(maxQuantity);
      return;
    }
    onChange(next);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = maxQuantity
      ? returnQuantitySchema(unit, maxQuantity).safeParse(draft)
      : quantitySchema(unit).safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте количество');
      return;
    }
    onChange(parsed.data);
    setOpen(false);
  };

  return (
    <div className="min-w-0">
      <p
        className={`mb-2 text-xs font-semibold text-muted-foreground ${
          tableLayout ? 'min-[1360px]:hidden' : ''
        }`}
      >
        Количество
      </p>
      <div className="grid w-full min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] overflow-hidden rounded-lg border border-border bg-background">
        <Button
          aria-label={`Уменьшить количество ${name}`}
          className="h-11 min-w-0 rounded-none border-r border-border px-0"
          disabled={disabled || !canDecrease}
          onClick={() => adjust(-1)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          aria-label={`Изменить количество ${name}`}
          className="h-11 min-w-0 overflow-hidden rounded-none px-1 text-sm font-bold tabular-nums"
          disabled={disabled}
          onClick={() => {
            setDraft(value);
            setError(null);
            setOpen(true);
          }}
          type="button"
          variant="ghost"
        >
          {formatQuantity(value, unit)}
        </Button>
        <Button
          aria-label={`Увеличить количество ${name}`}
          className="h-11 min-w-0 rounded-none border-l border-border px-0"
          disabled={disabled || !canIncrease}
          onClick={() => adjust(1)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Количество товара</DialogTitle>
            <DialogDescription>{name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submit}>
            <FormField>
              <Label htmlFor={`return-quantity-${controlId}`}>Количество</Label>
              <Input
                aria-label={`Количество ${name}`}
                aria-invalid={Boolean(error)}
                autoFocus
                id={`return-quantity-${controlId}`}
                inputMode="decimal"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                value={draft}
              />
              {maxQuantity ? (
                <p className="text-xs text-muted-foreground">
                  Доступно: {formatQuantity(maxQuantity, unit)}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm font-medium text-destructive">{error}</p>
              ) : null}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Отмена
                </Button>
              </DialogClose>
              <Button type="submit">Применить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ReceiptItems({
  disabled,
  onChange,
  receipt,
  selections,
}: {
  disabled: boolean;
  onChange: React.Dispatch<
    React.SetStateAction<Record<string, ReceiptSelection>>
  >;
  receipt: ReceiptResponse;
  selections: Record<string, ReceiptSelection>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="hidden grid-cols-[minmax(220px,1fr)_130px_190px_240px] gap-4 border-b border-border bg-muted/35 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-[1360px]:grid">
        <span>Товар</span>
        <span>Сумма</span>
        <span>Количество</span>
        <span>Состояние</span>
      </div>
      {receipt.items.map((item) => {
        const selected = selections[item.id];
        const fullyReturned = !/[1-9]/.test(item.returnable_quantity);
        const hasReturned = /[1-9]/.test(item.returned_quantity);
        const quantityIsValid = selected
          ? (!item.is_marked || selected.quantity === '1') &&
            returnQuantitySchema(
              item.unit_code,
              item.returnable_quantity,
            ).safeParse(selected.quantity).success
          : false;
        const amount =
          selected && quantityIsValid
            ? calculateReceiptReturnLineTotal(item, selected.quantity)
            : calculateReceiptReturnLineTotal(
                item,
                initialReceiptQuantity(item.returnable_quantity),
              );
        return (
          <div
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-4 py-4 last:border-b-0 min-[1360px]:grid-cols-[minmax(220px,1fr)_130px_190px_240px] ${
              selected
                ? 'bg-primary/[0.035]'
                : fullyReturned
                  ? 'bg-muted/25'
                  : ''
            }`}
            key={item.id}
          >
            <label className="flex min-w-0 cursor-pointer items-start gap-3">
              <input
                aria-label={`Выбрать ${item.name}`}
                checked={Boolean(selected)}
                className="mt-0.5 size-5 shrink-0"
                disabled={disabled || fullyReturned}
                onChange={(event) =>
                  onChange((current) => {
                    if (event.target.checked) {
                      return {
                        ...current,
                        [item.id]: {
                          quantity: initialReceiptQuantity(
                            item.is_marked ? '1' : item.returnable_quantity,
                          ),
                          returnDisposition: null,
                        },
                      };
                    }
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                  })
                }
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {item.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.sku} · доступно{' '}
                  {formatQuantity(item.returnable_quantity, item.unit_code)}
                </span>
                {hasReturned ? (
                  <span className="mt-2 inline-flex rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                    {fullyReturned
                      ? 'Возвращено полностью'
                      : `Возвращено: ${formatQuantity(
                          item.returned_quantity,
                          item.unit_code,
                        )}`}
                  </span>
                ) : null}
              </span>
            </label>

            <div>
              <p
                className={`font-bold tabular-nums ${selected ? 'text-primary' : ''}`}
              >
                {formatCash(amount)}
              </p>
            </div>

            {selected ? (
              <div className="col-span-2 min-w-0 min-[1360px]:col-span-1">
                <QuantityControl
                  controlId={`receipt-${item.id}`}
                  disabled={disabled || item.is_marked}
                  maxQuantity={item.returnable_quantity}
                  name={item.name}
                  onChange={(quantity) =>
                    onChange((current) => ({
                      ...current,
                      [item.id]: {
                        ...current[item.id]!,
                        quantity,
                      },
                    }))
                  }
                  tableLayout
                  unit={item.unit_code}
                  value={selected.quantity}
                />
              </div>
            ) : (
              <span className="hidden text-muted-foreground min-[1360px]:block">
                —
              </span>
            )}

            {selected ? (
              <div className="col-span-2 min-w-0 min-[1360px]:col-span-1">
                <DispositionButtons
                  name={item.name}
                  onChange={(returnDisposition) =>
                    onChange((current) => ({
                      ...current,
                      [item.id]: {
                        ...current[item.id]!,
                        returnDisposition,
                      },
                    }))
                  }
                  tableLayout
                  value={selected.returnDisposition}
                />
              </div>
            ) : (
              <span className="hidden text-muted-foreground min-[1360px]:block">
                —
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DispositionButtons({
  name,
  onChange,
  tableLayout = false,
  value,
}: {
  name: string;
  onChange: (value: ReturnDisposition) => void;
  tableLayout?: boolean;
  value: ReturnDisposition | null;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`mb-2 text-xs font-semibold text-muted-foreground ${
          tableLayout ? 'min-[1360px]:hidden' : ''
        }`}
      >
        Состояние товара
      </p>
      <div className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {dispositionOptions.map((option) => (
          <Button
            aria-label={`${option.label} ${name}`}
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            className="min-w-0 px-2"
            type="button"
            variant={value === option.value ? 'default' : 'ghost'}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function WithoutReceiptItems({
  canOverridePrice,
  lines,
  onOverride,
  onRemove,
  onUpdate,
}: {
  canOverridePrice: boolean;
  lines: WithoutReceiptLine[];
  onOverride: (line: WithoutReceiptLine) => void;
  onRemove: (lineId: string) => void;
  onUpdate: (lineId: string, update: Partial<WithoutReceiptLine>) => void;
}) {
  if (!lines.length) return null;
  return (
    <div className="space-y-3 border-t border-border pt-5">
      <h2 className="font-bold">Позиции возврата</h2>
      {lines.map((line) => {
        const parsedMarking = line.markingCode
          ? parseGs1DataMatrix(line.markingCode)
          : null;
        const duplicateMarking = Boolean(
          parsedMarking &&
          lines.some(
            (candidate) =>
              candidate.id !== line.id &&
              candidate.markingCode &&
              parseGs1DataMatrix(candidate.markingCode)?.markingCode ===
                parsedMarking.markingCode,
          ),
        );
        return (
          <div
            className="rounded-xl border border-border bg-background p-4"
            key={line.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{line.product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {line.product.sku}
                </p>
                {!line.product.is_active ? (
                  <span className="mt-1 inline-block text-xs font-semibold text-amber-700">
                    Неактивен
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <p className="font-bold">
                  {formatCash(getReturnUnitPrice(line))}
                </p>
                {canOverridePrice ? (
                  <Button
                    aria-label={`Изменить цену ${line.product.name}`}
                    onClick={() => onOverride(line)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  aria-label={`Удалить ${line.product.name}`}
                  onClick={() => onRemove(line.id)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            {line.product.nkt?.is_marked ? (
              <FormField className="mt-4">
                <Label htmlFor={`return-marking-${line.id}`}>Data Matrix</Label>
                <Input
                  id={`return-marking-${line.id}`}
                  maxLength={512}
                  onChange={(event) =>
                    onUpdate(line.id, { markingCode: event.target.value })
                  }
                  placeholder="Отсканируйте код с упаковки"
                  value={line.markingCode ?? ''}
                />
                {line.markingCode &&
                parsedMarking?.gtin !== line.product.nkt.gtin ? (
                  <p className="text-sm font-medium text-destructive">
                    Data Matrix не соответствует GTIN этого товара.
                  </p>
                ) : duplicateMarking ? (
                  <p className="text-sm font-medium text-destructive">
                    Этот Data Matrix уже добавлен в возврат.
                  </p>
                ) : null}
              </FormField>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <QuantityControl
                controlId={`without-${line.id}`}
                disabled={Boolean(line.product.nkt?.is_marked)}
                name={line.product.name}
                onChange={(quantity) => onUpdate(line.id, { quantity })}
                unit={line.product.unit}
                value={line.quantity}
              />
              <DispositionButtons
                name={line.product.name}
                onChange={(returnDisposition) =>
                  onUpdate(line.id, { returnDisposition })
                }
                value={line.returnDisposition}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
