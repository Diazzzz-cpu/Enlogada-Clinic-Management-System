import * as React from "react"
import { CalendarDays } from "lucide-react"

import { cn } from "../../lib/utils"
import { Input } from "./input"
import { Calendar } from "./calendar"
import { todayStr, daysAgoStr } from "../../lib/date"

/**
 * A date input whose calendar we actually own.
 *
 * The browser's picker is drawn outside the page and no CSS reaches it, so the only way to
 * improve it is to replace it. The important decision here is what NOT to replace: this keeps the
 * real `<input type="date">` and swaps only the popup.
 *
 * That is worth stating plainly, because replacing the input was the obvious move and is worse in
 * four separate ways:
 *
 *   - The value stays a bare ISO 'YYYY-MM-DD' string, so every caller, every form and every test
 *     that reads or fills it is unchanged. A text field rendering "14 Mar 1975" would have to be
 *     parsed back, and lib/date.js already documents why written months and typed dates are
 *     different problems.
 *   - `min`/`max` keep being enforced by the browser as a backstop under our own disabling, so a
 *     typed-in past date is still refused even if the popover is never opened.
 *   - `required` keeps participating in native form validation.
 *   - On a phone, tapping the field still opens the OS picker, which is genuinely better than any
 *     custom grid at 390px. Our popover is reached from the trigger button, so both exist and
 *     neither is in the other's way.
 *
 * The native calendar glyph is hidden in index.css (`::-webkit-calendar-picker-indicator`) so
 * there is one calendar icon on screen rather than two competing ones.
 *
 * @param presets    optional quick ranges for filter fields — [{ label, value }]. A report filter
 *                   is almost always answering "last 7 days", which a month grid answers slowly.
 * @param yearRange  passed to Calendar; enables month/year dropdowns. Set it for birthdates.
 * @param unavailable  passed to Calendar; { 'YYYY-MM-DD': 'reason' } days that cannot be picked.
 *                   Only reaches the custom picker — where the browser owns the picker (Firefox)
 *                   there is no way to grey a day, so the caller must still handle the choice
 *                   after the fact rather than relying on this to prevent it.
 */
/**
 * Can we take the browser's calendar glyph away? [1.34.0]
 *
 * Chromium and WebKit expose ::-webkit-calendar-picker-indicator, so index.css can hide the
 * native glyph and leave ours as the only icon. Firefox exposes NO equivalent — both
 * ::-moz-calendar-picker-indicator and ::-moz-calendar-button were tried and the parser discards
 * them as unrecognised selectors, and `appearance: textfield` leaves the glyph untouched.
 * Measured in Firefox 153, not assumed.
 *
 * That matters because Firefox draws its glyph INLINE, immediately after the date text (~x=380 in
 * a 150px field), not flush right where our trigger sits (x=405). So it cannot be covered either:
 * an opaque button over the right edge simply misses it.
 *
 * So the rule is all-or-nothing. Where the glyph can be removed we own the picker completely;
 * where it cannot, we render nothing of our own and the field behaves exactly as the browser
 * intends. One icon either way. The alternative — our button beside a glyph we cannot remove —
 * is two calendar icons a few pixels apart opening two different calendars.
 *
 * Feature-detected, never sniffed: Playwright's Firefox reports an AppleWebKit user-agent string,
 * so a UA test would answer this question wrongly on the very browser it is about.
 */
function useOwnsPicker() {
  return React.useMemo(() => (
    typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('selector(::-webkit-calendar-picker-indicator)')
  ), []);
}

/**
 * Is this a mouse, or a finger?
 *
 * On a touch device the OS date picker is genuinely better than a 280px grid on a 390px screen,
 * and tapping the field opens it already. Opening ours on top of that would stack two pickers, so
 * on coarse pointers the field click is left alone and our popover stays reachable from the
 * trigger. Hybrid laptops report `fine` while a mouse is in use, which is the behaviour we want:
 * the query describes the pointer currently being used, not the hardware in the box.
 */
function useFinePointer() {
  const [fine, setFine] = React.useState(true);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(pointer: fine)');
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return fine;
}

const DateField = React.forwardRef(({
  className, containerClassName, value, onChange, min, max, disabled,
  presets, yearRange, unavailable, ...props
}, ref) => {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const ownsPicker = useOwnsPicker();
  const finePointer = useFinePointer();

  // Close on outside click and on Escape. Escape returns focus to the trigger rather than
  // dropping it on the body, which is what makes the control usable without a mouse.
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // stopImmediatePropagation, not just stopPropagation. Radix's dismissable layer listens for
      // Escape on the same document node, so stopping propagation alone still lets its handler
      // run and the whole booking dialog closes behind the popover — one keypress undoing work
      // the patient has not finished. This consumes the key outright while we are open.
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    // Capture phase, so we see it before the layer beneath us does.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const emit = (next) => {
    // Shaped like a real change event so callers keep using `e.target.value` and nothing has to
    // learn a second calling convention.
    onChange?.({ target: { value: next } });
  };

  // Where the native glyph cannot be removed, add nothing at all: a plain field, behaving exactly
  // as the browser intends. Not a degraded experience — the browser's own picker, which is what
  // this field had before any of this existed.
  if (!ownsPicker) {
    return (
      <div className={cn("relative", containerClassName)}>
        <Input
          ref={ref}
          type="date"
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          disabled={disabled}
          className={className}
          {...props}
        />
      </div>
    );
  }

  return (
    // data-datefield-open is read by DialogContent: Radix registers its Escape listener in the
    // capture phase before this popover exists, so it can only be made to stand down, not
    // outrun. Without it one press closes the whole dialog behind an open calendar.
    <div
      ref={wrapRef}
      data-datefield
      data-datefield-open={open ? "true" : undefined}
      className={cn("relative", containerClassName)}
    >
      <Input
        ref={ref}
        type="date"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        disabled={disabled}
        className={cn("pr-9", className)}
        // Clicking the field opens the calendar, and typing still works. [1.34.0]
        //
        // Deliberately onClick and NOT onMouseDown-with-preventDefault: preventing the default
        // is what would stop the caret being placed and the segment being selected, which is
        // the typing this is supposed to leave alone. Nothing is prevented here, so the field
        // focuses exactly as it always did and the popover merely appears alongside.
        //
        // Safe against a second native picker because the indicator is display:none in this
        // engine — that rule is what stops the browser opening its own picker on a field click,
        // so hiding the glyph is load-bearing here and not only cosmetic.
        //
        // Fine pointers only: see useFinePointer.
        onClick={finePointer && !disabled ? () => setOpen(true) : undefined}
        {...props}
      />

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label="Open calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-r-lg text-slate-400 transition-colors hover:text-brand-600 disabled:pointer-events-none disabled:opacity-60"
      >
        <CalendarDays className="h-4 w-4" />
      </button>

      {/* Announced, because the input cannot say it itself. [1.34.0]
          ARIA in HTML permits no role and no aria-expanded on `input type=date`, and the APG
          combobox pattern that would carry them requires type="text" — which this component
          deliberately rejects, for the ISO value, native min/max, native required and the phone's
          OS picker. So a screen-reader user clicking the field would otherwise get a dialog
          opening silently behind them with no announcement at all. A live region is the only
          route left, and it is the honest one: it says what happened and how to undo it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {open ? 'Calendar opened. Press Escape to close.' : ''}
      </span>

      {open && (
        // shadow-float is the dropdown elevation per the UI rules; rounded-xl is the panel radius.
        // Right-aligned so a field near the viewport edge does not push the page sideways —
        // mobile-patient.spec.js asserts no horizontal overflow at 390px.
        <div
          role="dialog"
          aria-label="Choose a date"
          // Fixed width, and aligned to the field's LEFT edge.
          //
          // Both were wrong first time round and the screenshot showed it. Without a width the
          // popover sized itself to the preset row, which lays out wider than the calendar; with
          // `right-0` that surplus then hung off the left of a 150px filter field and slid under
          // the sidebar, clipping "Today" and "Last" clean off. Left-aligned it grows into the
          // content area instead, where there is room, and the fixed width makes the presets wrap
          // inside the calendar rather than dictating the size of the thing that contains them.
          className="absolute left-0 z-50 mt-1 w-[17.5rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-float"
        >
          {presets?.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-line p-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { emit(p.value()); setOpen(false); }}
                  className="rounded-lg px-2 py-1 text-fine font-semibold text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <Calendar
            value={value}
            min={min}
            max={max}
            yearRange={yearRange}
            unavailable={unavailable}
            onSelect={(next) => { emit(next); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
})
DateField.displayName = "DateField"

/**
 * The ranges a filter field is usually being asked for.
 *
 * Functions rather than values: computed at click time, so a screen left open overnight does not
 * hand back yesterday's idea of "today". Local getters throughout, via lib/date.js.
 */
const RANGE_PRESETS = {
  start: [
    { label: 'Today', value: () => todayStr() },
    { label: 'Last 7 days', value: () => daysAgoStr(6) },
    { label: 'Last 30 days', value: () => daysAgoStr(29) },
  ],
  end: [
    { label: 'Today', value: () => todayStr() },
  ],
};

/** Birthdates: 120 years back, and never in the future. */
const BIRTHDATE_YEAR_RANGE = [new Date().getFullYear() - 120, new Date().getFullYear()];

export { DateField, RANGE_PRESETS, BIRTHDATE_YEAR_RANGE }
