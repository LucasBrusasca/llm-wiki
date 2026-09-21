import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-7 w-full rounded-sm border border-hair bg-surface-2 px-2 text-[12.5px] text-ink',
      'placeholder:text-ink-dim transition-colors',
      'hover:border-hair-strong focus:border-accent/60 focus:outline-none',
      'disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };
