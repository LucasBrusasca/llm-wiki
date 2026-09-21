import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-[10.5px] font-medium leading-[16px] tracking-[0.01em] whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-hair bg-surface-2 text-ink-muted',
        accent:  'border-accent/30 bg-accent/12 text-accent-soft',
        quiet:   'border-transparent bg-transparent text-ink-dim',
        warn:    'border-warn/30 bg-warn/10 text-warn',
        danger:  'border-danger/30 bg-danger/10 text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
