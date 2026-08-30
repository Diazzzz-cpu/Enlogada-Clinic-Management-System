import React from 'react';
import { cn } from '../../lib/utils';

/**
 * The filter/search row that sits above a worklist.
 *
 * Every console had one, and every one of them was a white, bordered, shadowed box — visually
 * identical to the Panel holding the table underneath it. Two boxes of the same weight stacked on
 * top of each other read as two sections, so the controls looked unrelated to the list they
 * filtered.
 *
 * A Toolbar is lighter than a Panel on purpose: no fill, no shadow, and it sits in the same
 * visual layer as the canvas. It reads as chrome attached to the content below, which is what it
 * is. `attached` goes further and joins it to the panel beneath by squaring the bottom corners.
 */
const Toolbar = ({ children, attached = false, className }) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5',
      attached && 'rounded-b-none border-b-0',
      className
    )}
  >
    {children}
  </div>
);

/** Pushes everything after it to the right-hand end of the toolbar. */
export const ToolbarSpacer = () => <div className="ml-auto" />;

/**
 * A labelled control. The label sits above the input at 10px rather than beside it, so a row of
 * four filters lines its controls up on one baseline regardless of how long each label is —
 * inline labels made the date pickers sit at four different x-positions across the consoles.
 */
export const ToolbarField = ({ label, htmlFor, className, children }) => (
  <div className={cn('flex min-w-0 flex-col gap-1', className)}>
    {label && (
      <label htmlFor={htmlFor} className="text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </label>
    )}
    {children}
  </div>
);

/**
 * A segmented filter — the "All / Pending / Processing" style switch. Replaces the hand-rolled
 * `<select>` and the loose pill buttons that did this job differently on three screens.
 *
 * Options are `{ value, label, count? }`. A count renders as a trailing figure, which is what
 * makes this worth the space over a dropdown: staff can see there are 4 unpaid without opening
 * anything.
 */
export const SegmentedFilter = ({ options, value, onChange, className, ariaLabel }) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn('inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5', className)}
  >
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors',
            active
              ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
              : 'bg-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          {option.label}
          {option.count !== undefined && (
            <span
              className={cn(
                'rounded px-1 py-px text-micro font-bold tabular-nums',
                active ? 'bg-brand-100 text-brand-700' : 'bg-slate-200/80 text-slate-600'
              )}
            >
              {option.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export default Toolbar;
