import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { Loader2 } from "lucide-react"
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils"

// Focus rings are handled globally by the `:focus-visible` rule in index.css rather than
// per-variant here, so the app's hand-rolled `<button className="border-0">` elements — of which
// there are many, and which never picked up Tailwind's ring utilities — get the same treatment as
// these. Keyboard users were previously losing the cursor several times per screen.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-note font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The primary action. `active:` scale is deliberately absent — a button that shrinks
        // under the cursor feels playful, which is wrong on a screen where the primary action
        // takes a patient's money or releases a diagnostic report.
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-primary-hover active:bg-primary-active",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-destructive-hover active:bg-destructive-active",
        // `active:` on every variant, not only the filled ones. [1.54.0] outline and ghost had a
        // hover state and no press state, so on a touch screen — where there IS no hover — they
        // gave no feedback at all between the tap and whatever happened next. On the reception
        // terminal that is most of the buttons.
        outline:
          "border border-slate-200 bg-surface text-slate-700 shadow-[0_1px_2px_rgb(15_23_42_/_0.04)] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100",
        // The dark counterpart to `default`, for a second high-emphasis action beside it.
        secondary: "bg-emphasis text-emphasis-foreground shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-emphasis-hover active:bg-emphasis-active",
        subtle:
          "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 active:bg-slate-300",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
        link: "text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        // 36px. The old 40px default made a toolbar of four controls taller than the content it
        // filtered.
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-md px-2.5 text-fine",
        xs: "h-7 rounded-md px-2 text-fine [&_svg]:size-3.5",
        lg: "h-11 rounded-xl px-6 text-sm",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * `loading` puts the button in flight: a spinner appears, the button stops accepting clicks, and
 * assistive tech is told via `aria-busy`.
 *
 * It replaced a text swap that 43 buttons were each doing by hand — `{submitting ? 'Saving…' :
 * 'Save'}` — which had three problems. The copy had drifted ('Saving…' in six places, 'Saving…'
 * in four, and a ConfirmDialog that said 'Please wait...' on every destructive action in the app).
 * A static string gives no sign of life, so a slow request and a hung one look identical. And the
 * label growing mid-click reflows the row, moving whatever sits next to it out from under the
 * cursor at the exact moment somebody is clicking.
 *
 * The label is therefore kept, not swapped: "Take Payment" stays "Take Payment" and gains a
 * spinner. The width change is one icon rather than a whole word, and it never says less than it
 * did before the click.
 */
const Button = React.forwardRef(({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
  // Slot forwards to whatever child it is given and requires exactly one, so a spinner cannot be
  // injected here. asChild is for links and wrappers, which do not submit anything.
  if (asChild) {
    return (
      <Slot
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      // Both, deliberately: `disabled` stops the second click that submits a payment twice, and
      // `aria-busy` is what tells a screen reader the difference between "in flight" and
      // "unavailable to you".
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
