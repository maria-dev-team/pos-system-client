import { useMutation } from '@tanstack/react-query';
import { CircleCheck, LifeBuoy, LoaderCircle, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { sendSupportMessage } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { Label } from '@renderer/common/components/ui/label';
import { Textarea } from '@renderer/common/components/ui/textarea';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';

const MAX_MESSAGE_LENGTH = 6000;

export function SupportAction() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: sendSupportMessage,
    onSuccess: () => {
      setMessage('');
      setValidationError(null);
      setOpen(false);
      toast.success('Сообщение отправлено в службу поддержки');
    },
  });

  const close = () => {
    if (mutation.isPending) return;
    setValidationError(null);
    mutation.reset();
    setOpen(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setValidationError('Опишите вопрос или проблему.');
      return;
    }

    setValidationError(null);
    mutation.mutate({ message: trimmedMessage });
  };

  const error = mutation.isError
    ? getHttpErrorMessage(
        mutation.error,
        'Не удалось отправить сообщение. Повторите попытку.',
      )
    : null;

  return (
    <>
      <Button
        aria-label="Техническая поддержка"
        className="min-h-12 min-w-12 px-3"
        onClick={() => setOpen(true)}
        title="Техническая поддержка"
        type="button"
        variant="ghost"
      >
        <LifeBuoy aria-hidden="true" />
        <span className="sr-only">Техническая поддержка</span>
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
        open={open}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
          showCloseButton={!mutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>Техническая поддержка</DialogTitle>
            <DialogDescription>
              Опишите вопрос или проблему — команда Maria получит сообщение
              вместе с данными вашей организации, магазина и приложения.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" noValidate onSubmit={submit}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="pos-support-message">Сообщение</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>
              <Textarea
                aria-describedby={
                  validationError || error
                    ? 'pos-support-message-error'
                    : 'pos-support-message-hint'
                }
                aria-invalid={Boolean(validationError || error)}
                autoFocus
                className="min-h-44 resize-y"
                disabled={mutation.isPending}
                id="pos-support-message"
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (validationError) setValidationError(null);
                  if (mutation.isError) mutation.reset();
                }}
                placeholder="Например: не получается закрыть смену. При нажатии появляется ошибка…"
                value={message}
              />
              {validationError || error ? (
                <p
                  aria-live="polite"
                  className="px-1 text-sm font-medium text-destructive"
                  id="pos-support-message-error"
                >
                  {validationError ?? error}
                </p>
              ) : (
                <p
                  className="px-1 text-xs text-muted-foreground"
                  id="pos-support-message-hint"
                >
                  Не указывайте пароли, данные банковских карт и другие секреты.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-secondary/70 px-4 py-3 text-sm text-secondary-foreground">
              <CircleCheck aria-hidden="true" className="size-5 text-primary" />
              Контекст аккаунта и приложения приложится автоматически
            </div>

            <DialogFooter>
              <Button
                disabled={mutation.isPending}
                onClick={close}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
              <Button
                disabled={mutation.isPending || !message.trim()}
                type="submit"
              >
                {mutation.isPending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Send aria-hidden="true" />
                )}
                {mutation.isPending ? 'Отправляем...' : 'Отправить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
