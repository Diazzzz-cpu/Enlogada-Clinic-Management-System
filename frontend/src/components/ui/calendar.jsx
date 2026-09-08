import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "../../lib/utils"
import { toDateInput } from "../../lib/date"

/**
 * A month grid. The surface behind every calendar icon in the app.
 *
 * The browser's own picker cannot be styled — it is drawn by the browser outside the page, so no
 * CSS reaches it. Replacing it is therefore the only way to make one, and this is that
 * replacement. It does NOT replace the input: see date-field.jsx, which keeps the native
 * `<input type="date">` and swaps only the picker. Typing, ISO values, `min`, form validation and
 * the phone's OS keyboard all stay exactly as they were.
 *
 * ── Dates here are LOCAL, never UTC ─────────────────────────────────────────────────────────
 *
 * Every date in this file is built with `new Date(y, m, d)` and formatted with `toDateInput`,
 * which reads local getters. `new Date('2026-03-14')` is NOT the same thing — a bare date string
 * is parsed as UTC midnight, which in Manila is the previous day, every day, silently. That bug
 * has shipped twice in this project already; lib/date.js opens with the warning.
 *
 * ── Two things a hand-built calendar gets wrong ─────────────────────────────────────────────
 *
 * Both are handled here rather than left to be discovered:
 *
 *   Month-end clamping. Moving from 31 March to "previous month" with `setMonth(m - 1)` gives
 *   3 March, because February has no 31st and Date silently rolls forward. Navigation therefore
 *   moves a {year, month} pair and never a Date.
 *
 *   Disabled days must be unreachable by keyboard too, not merely unclickable. A grid where Tab
 *   or an arrow key lands on a day the server will reject is a control that lies.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** 'YYYY-MM-DD' -> a LOCAL Date, or null. Never `new Date(str)`; see the note above. */
function parseISO(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects 2026-02-31, which Date would happily roll into March.
  return date.getMonth() === m - 1 ? date : null;
}

/** Whole days between two local dates, sign-carrying. Compared as calendar days, not instants. */
function isBefore(a, b) {
  return new Date(a.getFullYear(), a.getMonth(), a.getDate())
       < new Date(b.getFullYear(), b.getMonth(), b.getDate());
}

/**
 * The 42 cells of a month view: leading days from the previous month, this month, then trailing.
 *
 * Always six weeks. A grid that changes height between months makes the popover jump under the
 * cursor, and the day you were aiming at moves as you click.
 */
function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/**
 * @param value      selected date as 'YYYY-MM-DD', or ''
 * @param onSelect   called with 'YYYY-MM-DD'
 * @param min/max    'YYYY-MM-DD' bounds, inclusive; days outside are unclickable and unfocusable
 * @param yearRange  when set, renders month + year dropdowns instead of a static caption. For
 *                   birthdates, where paging a month at a time to 1962 is ~770 clicks.
 * @param unavailable  optional { 'YYYY-MM-DD': 'reason' } — days that exist but cannot be chosen.
 *                   Distinct from min/max, which are a RANGE: this is a scatter of individual
 *                   dates inside an otherwise valid range, and each carries its own reason so the
 *                   reader is told why rather than left clicking a dead cell. Deliberately a plain
 *                   map with no notion of what the reason is about — the clinic's closures are one
 *                   caller, not the concept.
 */
const Calendar = React.forwardRef(({
  className, value, onSelect, min, max, yearRange, unavailable, ...props
}, ref) => {
  const selected = parseISO(value);
  const today = new Date();
  const minDate = parseISO(min);
  const maxDate = parseISO(max);

  // The month on screen. Opens on the selection, else today — so a field with a value opens
  // showing it rather than making the reader find it.
  const initial = selected || today;
  const [view, setView] = React.useState({ y: initial.getFullYear(), m: initial.getMonth() });

  // Follow the value when it changes underneath us (a preset button, a typed date).
  React.useEffect(() => {
    const next = parseISO(value);
    if (next) setView({ y: next.getFullYear(), m: next.getMonth() });
  }, [value]);

  const reasonFor = React.useCallback(
    (stamp) => (unavailable ? unavailable[stamp] : undefined),
    [unavailable]
  );

  const isDisabled = React.useCallback((date) => (
    (minDate && isBefore(date, minDate))
    || (maxDate && isBefore(maxDate, date))
    // A key present with any value blocks the day; the value is the explanation, and an empty
    // string is a legitimate "closed, no reason given".
    || (unavailable ? toDateInput(date) in unavailable : false)
  ), [minDate, maxDate, unavailable]);

  const shiftMonth = (delta) => setView(({ y, m }) => {
    const next = new Date(y, m + delta, 1);
    return { y: next.getFullYear(), m: next.getMonth() };
  });

  const days = buildGrid(view.y, view.m);
  const todayStamp = toDateInput(today);

  // Arrow keys move by day/week, so the grid behaves like a grid rather than like 42 tab stops.
  // Skips disabled days rather than landing on them and refusing to act.
  const onGridKeyDown = (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const from = selected || new Date(view.y, view.m, 1);
    for (let i = 1; i <= 366; i += 1) {
      const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + step * i);
      if (!isDisabled(candidate)) { onSelect(toDateInput(candidate)); return; }
    }
  };

  const years = React.useMemo(() => {
    if (!yearRange) return null;
    const [from, to] = yearRange;
    return Array.from({ length: to - from + 1 }, (_, i) => to - i);
  }, [yearRange]);

  return (
    <div ref={ref} className={cn("w-full p-3", className)} {...props}>
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {years ? (
          // Native selects, deliberately. This popover is already a floating layer; a second one
          // stacked inside it is where focus management stops being predictable.
          <div className="flex flex-1 items-center justify-center gap-1">
            <select
              value={view.m}
              onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
              aria-label="Month"
              className="rounded-lg border border-slate-200 bg-surface px-1.5 py-1 text-fine font-semibold text-slate-900 hover:border-slate-300"
            >
              {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
            </select>
            <select
              value={view.y}
              onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
              aria-label="Year"
              className="rounded-lg border border-slate-200 bg-surface px-1.5 py-1 text-fine font-semibold text-slate-900 hover:border-slate-300"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        ) : (
          <div aria-live="polite" className="flex-1 text-center text-sm font-bold text-slate-900">
            {MONTHS[view.m]} {view.y}
          </div>
        )}

        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" role="grid" onKeyDown={onGridKeyDown}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-meta font-bold uppercase tracking-wider text-slate-400">
            {d}
          </div>
        ))}

        {days.map((date) => {
          const stamp = toDateInput(date);
          const outside = date.getMonth() !== view.m;
          const disabled = isDisabled(date);
          const reason = reasonFor(stamp);
          const isSelected = value === stamp;

          return (
            <button
              key={stamp}
              type="button"
              disabled={disabled}
              // One tab stop for the whole grid: the arrow keys move within it. 42 stops would
              // make Tab a way of leaving the popover slowly.
              tabIndex={isSelected || (!value && stamp === todayStamp) ? 0 : -1}
              aria-current={stamp === todayStamp ? 'date' : undefined}
              aria-selected={isSelected}
              // The reason reaches a screen reader too. A disabled cell announced as nothing but
              // "31, dimmed" tells a blind reader less than the sighted one gets from hovering.
              title={reason || undefined}
              aria-label={reason ? `${stamp} — ${reason}` : undefined}
              onClick={() => onSelect(stamp)}
              className={cn(
                "h-8 rounded-lg text-fine font-semibold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                isSelected
                  ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                  : outside
                    ? "text-slate-300 hover:bg-slate-50"
                    : "text-slate-700 hover:bg-brand-50",
                // Today is marked, but never so strongly that it reads as the selection.
                !isSelected && stamp === todayStamp && "ring-1 ring-inset ring-brand-300 text-brand-700",
                disabled && "cursor-not-allowed text-slate-200 hover:bg-transparent",
                // Out of range fades away; unavailable is struck through, because "this date is
                // real and we are shut" is a different message from "this date is not in scope".
                reason && "line-through decoration-slate-300"
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
})
Calendar.displayName = "Calendar"

export { Calendar, parseISO }
