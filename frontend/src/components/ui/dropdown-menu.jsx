import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[190px] overflow-hidden rounded-md border border-hair-strong bg-surface p-1',
        'shadow-xl shadow-black/60',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

const itemBase =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] text-ink ' +
  'outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none ' +
  'data-[disabled]:opacity-40 [&_svg]:size-3.5 [&_svg]:shrink-0';

const DropdownMenuItem = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref} className={cn(itemBase, '[&_svg]:text-ink-dim', className)} {...props} />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

const Indicator = () => (
  <span className="absolute left-2 grid size-3.5 place-items-center">
    <DropdownMenuPrimitive.ItemIndicator>
      <Check className="size-3 text-accent" />
    </DropdownMenuPrimitive.ItemIndicator>
  </span>
);

const DropdownMenuCheckboxItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(itemBase, 'pl-7', className)} {...props}>
    <Indicator />
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

const DropdownMenuRadioItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(itemBase, 'pl-7', className)} {...props}>
    <Indicator />
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

function DropdownMenuLabel({ className, ...props }) {
  return (
    <div
      className={cn('px-2 pb-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-hair', className)} {...props} />;
}

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuRadioGroup,
  DropdownMenuLabel, DropdownMenuSeparator,
};
