import { type VariantProps, cva } from 'class-variance-authority';
import * as Slot from 'radix-ui/slot';
import type { ComponentProps } from 'react';

import { cn } from '@renderer/common/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/35 [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
  };

export function Badge({
  asChild = false,
  className,
  variant,
  ...props
}: BadgeProps) {
  const Component = asChild ? Slot.Root : 'span';

  return (
    <Component
      className={cn(badgeVariants({ className, variant }))}
      data-slot="badge"
      data-variant={variant}
      {...props}
    />
  );
}
