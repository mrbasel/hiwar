import { Dialog as Base } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { panelClass } from "#components/ui/panel";
import { cn } from "#lib/format";

export const Dialog = Base.Root;
export const DialogClose = Base.Close;

export function DialogPopup({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Base.Portal>
      <Base.Backdrop className="fixed inset-0 z-20 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <Base.Popup
        className={cn(
          panelClass,
          "fixed inset-0 z-20 m-auto h-fit w-[min(24rem,calc(100vw-2rem))] p-5 text-base",
          className,
        )}
      >
        <Base.Title className="mb-4 text-lg font-medium">{title}</Base.Title>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}
