import React from 'react';
import { cn } from '../../lib/utils';

/**
 * "This is still loading", said the same way everywhere. [1.54.0]
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 *
 * Panels were hand-rolling the same block, and the copies had drifted the way copies do. Three
 * examples, all doing one job:
 *
 *   PackagesPanel        w-6 h-6 · border-azure-500 · py-10 · text-fine  · text-slate-500 · "…"
 *   PaymentMethodsPanel  h-6 w-6 · border-azure-500 · py-10 · text-fine  · text-slate-500 · "…"
 *   ServicesTablePanel   w-8 h-8 · border-brand-500 · py-16 · text-xs    · text-gray-500  · "..."
 *
 * Different sizes, two different brand colours, two neutral ramps, and one of them spelling the
 * ellipsis out. None of that was decided; it accumulated. The same shape sits beside `EmptyState`
 * and `SkeletonList` — a screen now picks WHICH treatment it wants rather than reinventing one.
 *
 * ── Choosing between this and a skeleton ────────────────────────────────────────────────────
 *
 * A skeleton is right when the shape of what is coming is known and stable — a table of rows, a
 * list of cards — because it holds the layout still and the page does not jump when data lands.
 * A spinner is right when the wait is short, the region is small, or the result's shape varies.
 * Both are better than bare text, which gives the reader nothing to look at and no sense that
 * anything is happening.
 *
 * The spinner keeps spinning under `prefers-reduced-motion`: index.css re-declares
 * `.animate-spin` inside that media query at half speed, because the blanket rule would otherwise
 * stop it dead after one instant rotation and every loading indicator would read as a hang.
 */
const SIZES = {
  sm: { ring: 'h-5 w-5 border-[3px]', pad: 'py-6', text: 'text-fine' },
  md: { ring: 'h-6 w-6 border-4', pad: 'py-10', text: 'text-fine' },
  lg: { ring: 'h-8 w-8 border-4', pad: 'py-16', text: 'text-note' },
};

const LoadingState = ({ label = 'Loading…', size = 'md', className }) => {
  const s = SIZES[size] || SIZES.md;

  return (
    <div
      // role=status + aria-live: a screen reader is told the wait has started, and told once.
      // Without it the region simply goes quiet, which is indistinguishable from nothing
      // happening — the same complaint the sighted reader has about bare text.
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3', s.pad, className)}
    >
      <div
        className={cn('animate-spin rounded-full border-brand-500 border-t-transparent', s.ring)}
        aria-hidden="true"
      />
      <span className={cn('font-semibold text-slate-500', s.text)}>{label}</span>
    </div>
  );
};

export default LoadingState;
export { LoadingState };
