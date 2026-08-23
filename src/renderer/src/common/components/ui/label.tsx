import * as LabelPrimitive from 'radix-ui/label';
import type { ComponentProps } from 'react';

import { cn } from '@renderer/common/lib/utils';

export function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-sm font-semibold leading-none text-foreground',
        className,
      )}
      data-slot="label"
      {...props}
    />
  );
}
