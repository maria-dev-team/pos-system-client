import type { FormEventHandler } from 'react';

import { NumericKeypad } from '@renderer/common/components/numeric-keypad';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { VirtualKeyboard } from '@renderer/common/components/virtual-keyboard';

import type { WithoutReceiptLine } from '../returns.types';

type PriceOverrideDialogsProps = {
  error: string | null;
  line?: WithoutReceiptLine;
  onBack: () => void;
  onClose: () => void;
  onContinue: FormEventHandler<HTMLFormElement>;
  onPriceChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSave: FormEventHandler<HTMLFormElement>;
  price: string;
  reason: string;
  step: 'price' | 'reason';
};

export function PriceOverrideDialogs({
  error,
  line,
  onBack,
  onClose,
  onContinue,
  onPriceChange,
  onReasonChange,
  onSave,
  price,
  reason,
  step,
}: PriceOverrideDialogsProps) {
  return (
    <>
      <Dialog
        onOpenChange={(open) => !open && onClose()}
        open={Boolean(line && step === 'price')}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Изменить цену</DialogTitle>
            <DialogDescription>{line?.product.name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onContinue}>
            <FormField>
              <Label htmlFor="return-override-price">Новая цена, ₸</Label>
              <Input
                id="return-override-price"
                inputMode="decimal"
                onChange={(event) => onPriceChange(event.target.value)}
                value={price}
              />
              <NumericKeypad onValueChange={onPriceChange} value={price} />
            </FormField>
            {error ? (
              <p className="text-sm font-medium text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit">Далее</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && onClose()}
        open={Boolean(line && step === 'reason')}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Укажите причину изменения цены</DialogTitle>
            <DialogDescription>{line?.product.name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSave}>
            <FormField>
              <Label htmlFor="return-override-reason">
                Причина изменения цены
              </Label>
              <Input
                id="return-override-reason"
                maxLength={500}
                onChange={(event) => onReasonChange(event.target.value)}
                value={reason}
              />
              <VirtualKeyboard
                compact
                maxLength={500}
                onValueChange={onReasonChange}
                value={reason}
              />
            </FormField>
            {error ? (
              <p className="text-sm font-medium text-destructive">{error}</p>
            ) : null}
            <DialogFooter>
              <Button onClick={onBack} type="button" variant="ghost">
                Назад
              </Button>
              <Button type="submit">Сохранить цену</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
