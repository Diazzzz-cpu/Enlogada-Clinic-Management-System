import * as React from "react"

import { cn } from "../../lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        // 16px on mobile (iOS zooms the viewport on focus below that), 13px from `md` up where
        // the app is actually used all day. The focus treatment is the global one from
        // index.css plus a border shift, so the control itself reacts rather than only a ring
        // appearing outside it.
        // Focus is a border change AND a soft ring, at 150ms. A border colour alone is a one-pixel
        // event — on a form of six fields it is genuinely easy to lose which one you are in, and
        // the ring is what makes the answer readable at a glance rather than by inspection. Azure
        // because that is the interactive colour now, and it carries the AA contrast the green
        // could not.
        "flex h-9 w-full rounded-lg border border-slate-200 bg-surface px-3 py-2 text-base text-slate-900 transition-[color,background-color,border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-fine file:font-medium file:text-slate-700 placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-azure-400 focus-visible:ring-4 focus-visible:ring-azure-500/12 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 md:text-note",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
