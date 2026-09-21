import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-40 bg-black/70', className)}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2',
        'flex-col overflow-hidden rounded-md border border-hair-strong bg-surface shadow-2xl shadow-black/60',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

function CloseX() {
  return (
    <DialogPrimitive.Close
      className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label="Cerrar"
    >
      <X className="size-3.5" />
    </DialogPrimitive.Close>
  );
}

function DialogHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 hairline-b px-3.5 py-2.5', className)} {...props}>
      <div className="min-w-0">{children}</div>
      <CloseX />
    </div>
  );
}

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('truncate text-[13px] font-semibold tracking-[-0.01em] text-ink', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-0.5 text-[11.5px] text-ink-dim', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

// Sheet = Dialog anclado a un borde (mismo primitivo Radix).
const SheetContent = React.forwardRef(({ className, side = 'right', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay className="bg-black/55" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-50 flex w-[min(540px,94vw)] flex-col bg-surface shadow-2xl shadow-black/60',
        side === 'right' ? 'right-0 border-l border-hair-strong' : 'left-0 border-r border-hair-strong',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export {
  Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogOverlay,
  Dialog as Sheet, SheetContent, DialogHeader as SheetHeader,
  DialogTitle as SheetTitle, DialogDescription as SheetDescription,
};
