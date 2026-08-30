import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "../../lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // A segmented control, matching SegmentedFilter in toolbar.jsx — the two do the same job in
      // different places and previously looked nothing alike. `w-fit` so a two-tab strip does not
      // stretch across the page as the old `h-10 justify-center` version did on flex parents.
      "inline-flex w-fit items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-slate-500",
      className
    )}
    {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-note font-semibold transition-colors hover:text-slate-800 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-slate-900 data-[state=active]:shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]",
      className
    )}
    {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
