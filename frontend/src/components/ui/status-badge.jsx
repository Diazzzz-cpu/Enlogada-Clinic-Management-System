import * as React from "react"
import { Clock, Loader, FileSearch, CheckCircle2, XCircle, RotateCcw } from "lucide-react"

import { cn } from "../../lib/utils"
import { Badge } from "./badge"

// Canonical status → meaning mapping for this app (see .agents/_shared/VISUAL_IDENTITY.md,
// "Status-to-color mapping" decision). Covers every distinct status/approval_status value
// across patient_visits, appointments, visit_tests, hmo_requests, hmo_request_tests, and
// payments (per database/schema.sql's CHECK constraints) so one component can represent all
// of them consistently, replacing the three independently hand-copied color maps found by
// the 2026-08-10 audit (ClientDashboard.getStatusColor, ReceptionistDashboard's inline
// ternary, DiagnosticDashboard's inline ternary).
//
// Statuses are grouped by what they MEAN rather than styled one by one. Twelve statuses across
// six tables collapse into six situations a member of staff can be in, which is what makes a
// queue scannable: you are reading the shape of the work, not memorising a dozen colours.
//
// Each group carries an icon as well as a colour. Colour alone fails anyone with a colour vision
// deficiency — roughly 1 in 12 men — and it also fails everyone else on a sunlit reception
// monitor, where amber-100 and emerald-100 are near-identical pale rectangles. The glyph is the
// part that survives both, so it is not decoration; it is the primary cue, with colour
// reinforcing it. The ring does similar work, giving each badge a defined edge instead of a
// tint that dissolves into the row behind it.
const STATUS_GROUPS = {
  // Nothing is happening yet and someone is waiting on a person to act.
  waiting: {
    icon: Clock,
    className: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
    iconClassName: "text-amber-600",
  },
  // Work is underway right now.
  active: {
    icon: Loader,
    className: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200",
    iconClassName: "text-indigo-600",
  },
  // Done, but held for a second pair of eyes before it reaches the patient.
  review: {
    icon: FileSearch,
    className: "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200",
    iconClassName: "text-violet-600",
  },
  // Finished successfully. Nothing further is required.
  done: {
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
    iconClassName: "text-emerald-600",
  },
  // Stopped and will not complete. Deliberately the only group using red, so that red keeps
  // meaning "something is wrong" instead of becoming background noise.
  stopped: {
    icon: XCircle,
    className: "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200",
    iconClassName: "text-rose-600",
  },
  // Unwound after the fact — not a failure, but not a completion either.
  reversed: {
    icon: RotateCcw,
    className: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
    iconClassName: "text-slate-500",
  },
};

const STATUS_TO_GROUP = {
  Pending: "waiting",
  Processing: "active",
  // visit_tests only: the modality has performed the exam and recorded findings, and the
  // result is awaiting authorisation. Sits between Processing and Completed.
  "Waiting for Release": "review",
  Approved: "done",
  Confirmed: "done",
  Completed: "done",
  Paid: "done",
  Cancelled: "stopped",
  Rejected: "stopped",
  Failed: "stopped",
  "No Show": "stopped",
  Refunded: "reversed",
};

const DEFAULT_GROUP = {
  icon: null,
  className: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
  iconClassName: "",
};

// `children` replaces the words and keeps the status's colour and glyph: a worklist group says
// "5 Processing" in the badge that means Processing. [1.115.0]
function StatusBadge({ status, className, children, ...props }) {
  const group = STATUS_GROUPS[STATUS_TO_GROUP[status]] || DEFAULT_GROUP;
  const Icon = group.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent gap-1 pl-1.5 pr-2 whitespace-nowrap",
        group.className,
        className
      )}
      {...props}
    >
      {/* aria-hidden: the status text beside it already conveys this to a screen reader, and a
          second announcement would just be noise. The glyph is for visual scanning. */}
      {Icon && <Icon aria-hidden="true" className={cn("w-3 h-3 flex-shrink-0", group.iconClassName)} />}
      {children ?? status}
    </Badge>
  );
}

// Retained for callers that need the palette without the component (e.g. colouring a chart
// series to match its badge). Maps status → class string, as the previous export did.
const STATUS_STYLES = Object.fromEntries(
  Object.entries(STATUS_TO_GROUP).map(([status, group]) => [status, STATUS_GROUPS[group].className])
);

export { StatusBadge, STATUS_STYLES, STATUS_GROUPS, STATUS_TO_GROUP }
