import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const Command = React.forwardRef(({ className, ...props }, ref) => (
  <CommandPrimitive ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden text-ink', className)} {...props} />
));
Command.displayName = 'Command';

function CommandDialog({ open, onOpenChange, children, label = 'Buscar' }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[min(620px,94vw)] -translate-x-1/2 overflow-hidden rounded-md border border-hair-strong bg-surface shadow-2xl shadow-black/70"
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Búsqueda global en la sección</DialogPrimitive.Description>
          <Command shouldFilter={false}>{children}</Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const CommandInput = React.forwardRef(({ className, ...props }, ref) => (
  <div className="flex items-center gap-2 hairline-b px-3">
    <Search className="size-4 shrink-0 text-ink-dim" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn('h-11 w-full bg-transparent text-[13.5px] text-ink placeholder:text-ink-dim outline-none', className)}
      {...props}
    />
  </div>
));
CommandInput.displayName = 'CommandInput';

const CommandList = React.forwardRef(({ className, ...props }, ref) => (
  <CommandPrimitive.List ref={ref} className={cn('max-h-[52vh] overflow-y-auto p-1', className)} {...props} />
));
CommandList.displayName = 'CommandList';

const CommandEmpty = (props) => (
  <CommandPrimitive.Empty className="px-3 py-8 text-center text-[12.5px] text-ink-dim" {...props} />
);

const CommandGroup = React.forwardRef(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2',
      '[&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase',
      '[&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-ink-dim',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = 'CommandGroup';

const CommandItem = React.forwardRef(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12.5px] outline-none',
      'data-[selected=true]:bg-surface-2 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-dim',
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = 'CommandItem';

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
