import * as React from "react"
import { Sun, Moon, Monitor } from "lucide-react"

import { cn } from "../../lib/utils"
import { useTheme } from "../../contexts/ThemeContext"

/**
 * One icon button, cycling Light → Dark → System. [1.39.0]
 *
 * This was a three-wide segmented control, and on the public header it read as a grey slab
 * floating beside the Create Account button. Two separate causes, both worth recording because
 * either alone would have been enough:
 *
 *   It was a SIBLING of the `hidden md:flex` nav cluster rather than a child of it, so at desktop
 *   width the header row had three flex items under `justify-between` — brand, nav, toggle — and
 *   the toggle was pinned to the far edge with a hole opening beside the CTA.
 *
 *   Its ground was `bg-slate-100 p-0.5`, which in this codebase is the SEGMENTED-CONTROL surface
 *   (SegmentedFilter, tabs.jsx, Navbar's Dashboard/Account switch all share it). Among a row of
 *   text links and one green button, that ground is what made it read as a slab.
 *
 * A single 36px bordered icon button is the header's existing idiom — both burgers and the
 * notification bell are exactly this shape — so it now sits in the row as another control rather
 * than as a panel someone dropped in.
 *
 * ── The cost of cycling, stated plainly ────────────────────────────────────────────────────
 *
 * A segmented control shows its options; a cycling one does not. Nothing else in this app cycles
 * through three states, so this is a new gesture, and that is a real trade rather than a free
 * win. It is paid for two ways: the glyph always shows the CURRENT state, and the accessible name
 * and tooltip both say what the NEXT press will do, so the control explains itself on hover and
 * to a screen reader without being clicked.
 *
 * `data-preference` is on the button so a test can assert the state it reached rather than
 * counting clicks — the cycle order is an implementation detail and a spec should not encode it.
 *
 * The accessible name deliberately contains neither "menu" nor "navigation":
 * mobile-patient.spec.js matches header buttons on /menu|navigation/i with `.first()`, so a
 * collision would silently pick this button instead of the burger.
 */

// Order matters only here. Everything else reads the current value rather than assuming position.
const CYCLE = ['light', 'dark', 'system'];

const META = {
  light: { Icon: Sun, label: 'Light' },
  dark: { Icon: Moon, label: 'Dark' },
  system: { Icon: Monitor, label: 'System' },
};

const ThemeToggle = React.forwardRef(({ className, ...props }, ref) => {
  const { preference, setPreference } = useTheme();

  const current = META[preference] ? preference : 'system';
  const { Icon, label } = META[current];
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  const nextLabel = META[next].label;

  return (
    <button
      ref={ref}
      type="button"
      data-testid="theme-toggle"
      data-preference={current}
      onClick={() => setPreference(next)}
      // Says what pressing it does, not what it currently is — the glyph already carries that.
      aria-label={`Theme: ${label}. Switch to ${nextLabel}.`}
      title={`Theme: ${label} — switch to ${nextLabel}`}
      className={cn(
        // The header's icon-button shape, matching both burgers and the notification bell.
        "flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-surface text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900",
        className
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">{`${label} theme`}</span>
    </button>
  );
})
ThemeToggle.displayName = "ThemeToggle"

export { ThemeToggle }
