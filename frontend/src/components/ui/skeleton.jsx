import React from 'react';
import { cn } from '../../lib/utils';

// Placeholder shapes shown while data loads, in place of a line of centred grey text.
//
// Twenty-seven "Loading…" strings across the app all shared the same two problems. They occupy a
// single line where the real content will occupy many, so the page jumps the moment data lands —
// and a jump is the one thing guaranteed to make an interface feel unreliable, because anything
// the user was about to click moves out from under them. And a short string in the middle of a
// large empty panel reads as "nothing here" rather than "not yet"; on a slow connection people
// conclude the queue is empty and walk away from a screen that is about to fill.
//
// A skeleton answers both: it reserves the real height and it is unmistakably a loading state.
//
// Deliberately not animated with a sweeping shimmer. A pulse is enough to read as active, and on
// a queue screen that a receptionist keeps open all day a constant sweep in peripheral vision is
// an irritation rather than an affordance. `motion-reduce:animate-none` drops even the pulse for
// anyone who has asked the OS for less motion — vestibular triggers are a real accessibility
// concern, not a preference.
export function Skeleton({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse motion-reduce:animate-none rounded-md bg-skeleton', className)}
    />
  );
}

/**
 * A stand-in for a list of cards or rows. `rows` should match what the real list usually shows,
 * so the reserved height is close to the final height.
 */
export function SkeletonList({ rows = 3, className }) {
  return (
    // role=status + aria-busy announces "loading" once to a screen reader, instead of the
    // decorative bars being read out or passed over in silence.
    <div role="status" aria-busy="true" aria-label="Loading" className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-2.5 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/**
 * A stand-in for table rows. Renders inside an existing <TableBody>, so the header and column
 * widths stay put and the table does not reflow when real rows replace these.
 */
export function SkeletonRows({ rows = 5, columns = 4 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="py-3.5 px-4">
              {/* Varying widths: uniform bars read as a rendered table of identical values
                  rather than as absent content. */}
              <Skeleton className={c === 0 ? 'h-3 w-16' : c === columns - 1 ? 'h-7 w-24 rounded-lg' : 'h-3 w-3/4'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default Skeleton;
