import { X } from 'lucide-react';
import * as DialogPrimitive from 'radix-ui/dialog';
import type { ComponentProps } from 'react';

import { cn } from '@renderer/common/lib/utils';

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogClose(
  props: ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogContent({
  children,
  className,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border border-border bg-card p-6 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-8',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-3 top-3 grid size-11 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35">
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2 pr-8', className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

export function DialogTitle(
  props: ComponentProps<typeof DialogPrimitive.Title>,
) {
  return (
    <DialogPrimitive.Title
      className="text-xl font-bold tracking-[-0.02em] text-card-foreground"
      data-slot="dialog-title"
      {...props}
    />
  );
}

export function DialogDescription(
  props: ComponentProps<typeof DialogPrimitive.Description>,
) {
  return (
    <DialogPrimitive.Description
      className="text-sm leading-6 text-muted-foreground"
      data-slot="dialog-description"
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid gap-3 sm:grid-cols-2', className)}
      data-slot="dialog-footer"
      {...props}
    />
  );
}
