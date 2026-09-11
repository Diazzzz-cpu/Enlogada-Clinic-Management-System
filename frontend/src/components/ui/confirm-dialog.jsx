import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog"
import { Button } from "./button"
import { AlertCircle } from "lucide-react"

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  loading = false,
  // Off by default, so every existing caller keeps a confirm button that is always live. Set by
  // a dialog whose decision needs something ticked or typed before it may be taken — the point
  // being that the button is visibly unavailable rather than clickable and then refused.
  confirmDisabled = false,
  error = "",
  // Anything the decision needs before it can be made — most often a reason field, because a
  // refusal that names no reason leaves whoever answers the phone afterwards with nothing to say.
  children
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs text-gray-500">{description}</DialogDescription>
        </DialogHeader>

        {children && <div className="space-y-2">{children}</div>}

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          {/* The label stays put. It used to become "Please wait...", which threw away the one
              piece of information the person needed at that moment — this is the dialog that
              confirms a refund, a cancellation or a released report, and after clicking they can
              no longer see which of those they agreed to. */}
          <Button type="button" onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
