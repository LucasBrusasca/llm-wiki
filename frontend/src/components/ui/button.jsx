import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-ink hover:bg-accent/90',
        outline: 'border border-hair-strong bg-transparent text-ink hover:bg-surface-2 hover:border-hair-strong',
        ghost:   'text-ink-muted hover:bg-surface-2 hover:text-ink',
        subtle:  'bg-surface-2 text-ink hover:bg-surface-3',
        danger:  'border border-hair-strong text-danger hover:bg-danger/10 hover:border-danger/40',
      },
      size: {
        sm:   'h-6 px-2 text-[12px] [&_svg]:size-3.5',
        md:   'h-7 px-2.5 text-[12.5px] [&_svg]:size-3.5',
        lg:   'h-8 px-3 text-[13px] [&_svg]:size-4',
        icon: 'size-7 [&_svg]:size-4',
        'icon-sm': 'size-6 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
