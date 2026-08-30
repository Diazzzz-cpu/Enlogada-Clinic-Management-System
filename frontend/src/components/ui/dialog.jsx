import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "../../lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Slate rather than pure black, at half strength with a light blur. `bg-black/80` on a
      // clinical screen blacks the page out so completely that the dialog reads as a new page
      // rather than a step on top of the one behind it — staff lose their place in the queue
      // they were working through.
      "fixed inset-0 z-50 bg-scrim/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Escape closes the innermost thing, not the outermost. [1.34.0]
 *
 * Radix registers its Escape listener on the document in the CAPTURE phase when the dialog
 * mounts — before any popover inside it exists — so a later listener can never run first,
 * whatever phase it uses. One press therefore closed the whole dialog while a date popover was
 * still open on top of it, throwing away a half-filled booking form to dismiss a calendar.
 *
 * Radix skips its own dismiss when the event has been defaultPrevented by this callback, so
 * deferring is the supported way out. The check is a DOM query rather than context because
 * DateField is a leaf that knows nothing about the dialog it happens to be rendered inside, and
 * a context would make every consumer wire something up to get correct behaviour by default.
 *
 * DateField clears the attribute as it closes, so the next Escape reaches the dialog normally.
 */
const DialogContent = React.forwardRef(({ className, children, onEscapeKeyDown, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onEscapeKeyDown={(event) => {
        if (document.querySelector('[data-datefield-open]')) event.preventDefault();
        onEscapeKeyDown?.(event);
      }}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid max-h-[90vh] w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-overlay duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}>
      {children}
      <DialogPrimitive.Close
        className="absolute right-3.5 top-3.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-bold leading-tight tracking-tight text-slate-900", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-note leading-relaxed text-slate-500", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
