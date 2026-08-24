import type { ComponentProps } from 'react';

import { cn } from '@renderer/common/lib/utils';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/15 disabled:pointer-events-none disabled:opacity-50 md:text-sm',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}
