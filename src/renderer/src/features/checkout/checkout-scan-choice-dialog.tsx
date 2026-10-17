import { useRef, useState } from 'react';

import type { ProductUnit } from '@renderer/common/api/responses/product.response';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import { formatQuantity, quantitySchema } from '@renderer/common/lib/quantity';

import type {
  ScanAmbiguity,
  ScanCandidate,
} from '../../../../shared/pos/barcode-scan';

const unavailableMessages: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'Товар недоступен в этом магазине',
  PRODUCT_NOT_SELLABLE: 'Этот товар нельзя продавать',
  PRODUCT_SALE_PRICE_REQUIRED: 'Для товара не указана цена продажи',
  SCALE_BARCODE_INVALID: 'Этикетка не соответствует весовому товару',
};

type Props = {
  ambiguity: ScanAmbiguity;
  onConfirm: (candidate: ScanCandidate, quantity: string) => Promise<unknown>;
  onClose: () => void;
};

export function CheckoutScanChoiceDialog({
  ambiguity,
  onConfirm,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<ScanCandidate | null>(null);
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const submitted = useRef(false);
  const confirm = async () => {
    if (
      !selected?.product_id ||
      selected.unavailable_reason ||
      submitted.current
    )
      return;
    const value = selected.kind === 'weighted' ? selected.quantity : quantity;
    const parsed = quantitySchema(selected.unit as ProductUnit).safeParse(
      value?.replace(',', '.'),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Введите количество товара.');
      return;
    }
    submitted.current = true;
    setAttempted(true);
    setPending(true);
    setError(null);
    try {
      await onConfirm(selected, parsed.data);
      onClose();
    } catch (failure) {
      // A failed reply can follow an accepted command. Disable further attempts;
      // the command mutation refreshes version conflicts without replaying them.
      setError(
        getHttpErrorMessage(
          failure,
          'Не удалось добавить товар. Проверьте чек и повторите сканирование.',
        ),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Выберите товар по штрихкоду</DialogTitle>
          <DialogDescription>
            {ambiguity.candidates.length === 1
              ? 'Укажите добавляемое количество товара.'
              : 'Код допускает несколько трактовок. Выберите нужную перед добавлением в чек.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {ambiguity.candidates.map((candidate, index) => {
            const unavailable =
              candidate.unavailable_reason ||
              (!candidate.product_id
                ? 'PRODUCT_NOT_FOUND'
                : candidate.retail_price === null
                  ? 'PRODUCT_SALE_PRICE_REQUIRED'
                  : null);
            return (
              <Button
                key={`${candidate.kind}:${candidate.product_id}:${index}`}
                type="button"
                className="h-auto w-full flex-col items-start whitespace-normal py-3 text-left"
                variant={selected === candidate ? 'default' : 'ghost'}
                disabled={Boolean(unavailable) || attempted}
                onClick={() => {
                  setSelected(candidate);
                  setQuantity(
                    candidate.kind === 'static' && candidate.unit === 'pcs'
                      ? '1'
                      : '',
                  );
                  setError(null);
                }}
              >
                <span>
                  {candidate.kind === 'weighted'
                    ? `Весовая этикетка${candidate.quantity ? ` — ${formatQuantity(candidate.quantity, 'kg')}` : ''}`
                    : 'Обычный штрихкод'}
                </span>
                {candidate.name ? <span>{candidate.name}</span> : null}
                {candidate.retail_price !== null ? (
                  <span>{formatCash(candidate.retail_price)}</span>
                ) : null}
                {unavailable ? (
                  <span>{unavailableMessages[unavailable] ?? unavailable}</span>
                ) : null}
              </Button>
            );
          })}
        </div>
        {selected?.kind === 'static' ? (
          <div className="space-y-2">
            <Label htmlFor="scan-choice-quantity">
              {selected.unit === 'kg'
                ? 'Вес обычного товара, кг'
                : 'Добавляемое количество'}
            </Label>
            <Input
              id="scan-choice-quantity"
              inputMode="decimal"
              value={quantity}
              disabled={attempted}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={!selected || attempted}
            onClick={() => void confirm()}
          >
            Добавить в чек
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
