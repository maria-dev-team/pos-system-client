import { Pencil, Trash2 } from 'lucide-react';

import type { ReceiptResponse, ReturnDisposition } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { formatQuantity } from '@renderer/common/lib/quantity';

import {
  calculateReturnLineTotal,
  getReturnUnitPrice,
} from '../returns-calculations';
import { returnQuantitySchema } from '../returns.schema';
import type { ReceiptSelection, WithoutReceiptLine } from '../returns.types';

const dispositionOptions = [
  { label: 'На склад', value: 'RESTOCK' },
  { label: 'Списать', value: 'WRITE_OFF' },
] as const;

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
    <div className="space-y-3">
      {receipt.items.map((item) => {
        const selected = selections[item.id];
        const fullyReturned = !/[1-9]/.test(item.returnable_quantity);
        return (
          <div
            className="rounded-xl border border-border bg-background p-4"
            key={item.id}
          >
            <div className="flex items-start gap-3">
              <input
                aria-label={`Выбрать ${item.name}`}
                checked={Boolean(selected)}
                className="mt-1 size-5"
                disabled={disabled || fullyReturned}
                onChange={(event) =>
                  onChange((current) => {
                    if (event.target.checked) {
                      return {
                        ...current,
                        [item.id]: { quantity: '', returnDisposition: null },
                      };
                    }
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                  })
                }
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku} · доступно{' '}
                      {formatQuantity(item.returnable_quantity, item.unit_code)}
                    </p>
                  </div>
                  <p className="font-bold">{formatCash(item.unit_price)}</p>
                </div>
                {fullyReturned ? (
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">
                    Полностью возвращено
                  </p>
                ) : null}
                {selected ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <FormField>
                      <Label htmlFor={`receipt-quantity-${item.id}`}>
                        Количество {item.name}
                      </Label>
                      <Input
                        aria-label={`Количество ${item.name}`}
                        id={`receipt-quantity-${item.id}`}
                        inputMode="decimal"
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            [item.id]: {
                              ...current[item.id]!,
                              quantity: event.target.value,
                            },
                          }))
                        }
                        value={selected.quantity}
                      />
                    </FormField>
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
                      value={selected.returnDisposition}
                    />
                    {returnQuantitySchema(
                      item.unit_code,
                      item.returnable_quantity,
                    ).safeParse(selected.quantity).success ? (
                      <p className="text-sm font-bold text-primary sm:col-span-2">
                        Сумма:{' '}
                        {formatCash(
                          calculateReturnLineTotal(
                            selected.quantity,
                            item.unit_price,
                          ),
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DispositionButtons({
  name,
  onChange,
  value,
}: {
  name: string;
  onChange: (value: ReturnDisposition) => void;
  value: ReturnDisposition | null;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Состояние товара</p>
      <div className="grid grid-cols-2 gap-2">
        {dispositionOptions.map((option) => (
          <Button
            aria-label={`${option.label} ${name}`}
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
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
  onRemove: (productId: string) => void;
  onUpdate: (productId: string, update: Partial<WithoutReceiptLine>) => void;
}) {
  if (!lines.length) return null;
  return (
    <div className="space-y-3 border-t border-border pt-5">
      <h2 className="font-bold">Позиции возврата</h2>
      {lines.map((line) => (
        <div
          className="rounded-xl border border-border bg-background p-4"
          key={line.product.id}
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
                onClick={() => onRemove(line.product.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FormField>
              <Label htmlFor={`without-quantity-${line.product.id}`}>
                Количество {line.product.name}
              </Label>
              <Input
                aria-label={`Количество ${line.product.name}`}
                id={`without-quantity-${line.product.id}`}
                inputMode="decimal"
                onChange={(event) =>
                  onUpdate(line.product.id, { quantity: event.target.value })
                }
                value={line.quantity}
              />
            </FormField>
            <DispositionButtons
              name={line.product.name}
              onChange={(returnDisposition) =>
                onUpdate(line.product.id, { returnDisposition })
              }
              value={line.returnDisposition}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
