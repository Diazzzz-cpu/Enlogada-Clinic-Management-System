import React from 'react';
import { cn } from '../../lib/utils';

/**
 * The section container, defined once.
 *
 * One card-chrome class string — a hairline border, a near-invisible shadow, a large radius and a
 * white fill — appeared verbatim (or near enough) forty-one times across the consoles, and the
 * copies that had drifted apart differed by a shadow step here and a border shade there. Those
 * were not decisions anyone made. Worse, the same treatment wrapped a KPI strip, a filter row and
 * a 200-row table alike, so nothing on a page announced itself as the primary content.
 *
 * A Panel is deliberately flat: a hairline border, no shadow, and its separation from the canvas
 * comes from the border plus the canvas being tinted rather than white. Shadow is reserved for
 * things that genuinely float (see `--shadow-float` / `--shadow-overlay` in index.css), so when
 * something does lift, it means something.
 *
 * `tone="sunken"` is for a panel nested inside another panel — a bill summary inside the POS,
 * say — where a second white box on white would vanish.
 */

const TONE = {
  default: 'bg-surface border-line',
  sunken: 'bg-slate-50/80 border-slate-200/80',
  // A panel whose content needs to read as urgent without shouting. Used for the critical-value
  // callback list and the unpaid-balance warning.
  alert: 'bg-rose-50/60 border-rose-200',
  notice: 'bg-amber-50/60 border-amber-200',
  brand: 'bg-brand-50/70 border-brand-200',
  dark: 'bg-[#16212e] border-[#2b3a4d] text-white',
};

export const Panel = React.forwardRef(({ tone = 'default', interactive = false, className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-xl border',
      TONE[tone] || TONE.default,
      interactive && 'transition-shadow duration-200 hover:shadow-raised',
      className
    )}
    {...props}
  >
    {children}
  </div>
));
Panel.displayName = 'Panel';

/**
 * A panel's header row. `title` is a string or node; `actions` sits hard right and stays on the
 * same line down to `sm`, because a filter control that wraps under its own heading reads as
 * belonging to the content below it rather than to the panel.
 */
export const PanelHeader = ({ title, description, icon: Icon, actions, className, children }) => (
  <div
    className={cn(
      'flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5',
      className
    )}
  >
    <div className="flex min-w-0 items-center gap-2.5">
      {Icon && (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0">
        {/* h2, not h3.
            The page title is an h1 (PageHeader), and a panel is the next level down, so an h3
            here skips a level — an audit found that jump on almost every screen. A screen reader
            user navigating by heading reads the outline as though a section were missing, and
            the visual size is set by the class either way, so nothing moves. */}
        {title && <h2 className="m-0 truncate text-note font-semibold text-slate-900">{title}</h2>}
        {description && <p className="m-0 mt-0.5 truncate text-fine font-normal text-slate-500">{description}</p>}
        {children}
      </div>
    </div>
    {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/**
 * `flush` drops the padding, for a panel whose whole body is a table or a divided list — those
 * bring their own cell padding, and doubling it leaves a visible gutter inside the border.
 */
export const PanelBody = ({ flush = false, className, children }) => (
  <div className={cn(flush ? '' : 'p-5', className)}>{children}</div>
);

export const PanelFooter = ({ className, children }) => (
  <div className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50/60 px-5 py-3', className)}>
    {children}
  </div>
);

export default Panel;
