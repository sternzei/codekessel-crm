"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface AccessibleDialogProps {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

/** Thin brand-neutral Radix wrapper with focus trap and Escape handling. */
export const AccessibleDialog = ({
  trigger,
  title,
  description,
  children,
}: AccessibleDialogProps): ReactNode => (
  <DialogPrimitive.Root>
    <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
      <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-ck-md border border-ck-line bg-ck-surface p-6 text-ck-ink shadow-ck-raised focus:outline-none">
        <DialogPrimitive.Title className="text-lg font-semibold">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-2 text-sm text-ck-ink-soft">
          {description}
        </DialogPrimitive.Description>
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close asChild>
          <button
            type="button"
            className="mt-6 min-h-11 rounded-ck-sm border border-ck-line px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ck-accent"
          >
            Schließen
          </button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);
