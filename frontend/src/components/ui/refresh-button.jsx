import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

/**
 * "Show me what is there now." [1.58.0]
 *
 * Four screens polled; the rest fetched once on mount and then showed whatever they had caught,
 * indefinitely. A console left open across a shift is the normal case in a clinic — nobody closes
 * the browser between patients — so an admin looking at Service Requests was routinely reading a
 * queue as it stood two hours ago, with nothing on screen to suggest it.
 *
 * The stale figure is the harm, not the missing button. Which is why this renders the TIME OF THE
 * READING beside the control rather than only the control: a screen that can be refreshed still
 * cannot be trusted unless it says how old it is. "Updated 08:14" on a 15:00 shift is the whole
 * message; the button is just what you do about it.
 *
 * Not a substitute for polling. A worklist that must not go stale still polls (`usePolling`);
 * this is for the screens where a fetch-per-view is right and the reader occasionally wants a
 * newer one.
 */
const RefreshButton = ({
  onRefresh,
  loading = false,
  // The moment the data on screen was read. Omit where it would be noise — a dialog, a screen
  // that mounts fresh every time.
  updatedAt = null,
  label = 'Refresh',
  // Icon only, for a crowded toolbar. The accessible name survives either way.
  compact = false,
  className,
  ...props
}) => (
  <div className={cn('flex items-center gap-2', className)}>
    {updatedAt && (
      <span className="whitespace-nowrap text-micro font-medium tabular-nums text-slate-400">
        Updated {new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    )}
    <Button
      variant="outline"
      size="sm"
      onClick={onRefresh}
      disabled={loading}
      aria-label={label}
      title={label}
      {...props}
    >
      {/* Spun by hand rather than through <Button loading>, which swaps in its own spinner and
          would drop the icon this control is recognised by. `.animate-spin` is deliberately
          exempt from the reduced-motion kill — see [1.39.0]. */}
      <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
      {!compact && label}
    </Button>
  </div>
);

export default RefreshButton;
export { RefreshButton };
