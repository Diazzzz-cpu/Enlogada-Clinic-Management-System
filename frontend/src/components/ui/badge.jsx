import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  // `rounded-md`, not `rounded-full`. A fully-round pill reads as a button you can press; a
  // squared tag reads as a label, which is what a status is. On a queue where every row carries
  // one and some rows also carry a real action button, that distinction stops staff clicking the
  // status.
  "inline-flex items-center rounded-md border px-2 py-0.5 text-fine font-semibold leading-5 transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-emphasis text-emphasis-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-slate-200 bg-surface text-slate-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
