import React from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';

// Shared metric/KPI card, used across every dashboard (Admin, Reports, Receptionist, Cashier,
// Diagnostic Staff, Client).
//
// ── Why the shape changed ────────────────────────────────────────────────────────────────────
// The previous version put the number on the left and a large pale tinted square on the right,
// with a saturated rule down the leading edge. Two things were wrong with it once you looked at
// a row of four rather than one in isolation:
//
//  * The icon square was the most visually prominent thing on the card, and it carries the least
//    information. Every reader's eye landed on a decorative pastel rectangle before it reached
//    the figure the card exists to show.
//  * The left rule plus the icon tint plus the coloured caption meant each card announced its
//    tone three times, so a strip of four read as four different-coloured objects rather than
//    one set of related figures.
//
// Now the tone is stated once, quietly, at the smallest element on the card — a 7px icon tile
// beside the label — and the figure gets the whole width beneath it. That is the arrangement
// used by essentially every modern operational dashboard, and it is not fashion: the label tells
// you what you are about to read, the number is the payload, the delta qualifies it. Reading top
// to bottom in that order is faster than reading left-to-right across a decorative element.
//
// The peripheral-grouping job the old left-rule was doing is now done by the icon tile keeping
// the same hue for the same meaning as the status badges below it, which was always the part
// that actually mattered.

const ICON_TONE = {
  green: 'bg-brand-100 text-brand-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  rose: 'bg-rose-100 text-rose-700',
  purple: 'bg-purple-100 text-purple-700',
  slate: 'bg-slate-200/70 text-slate-600',
};

const DARK_ICON_TONE = {
  green: 'bg-brand-500/20 text-brand-300',
  emerald: 'bg-emerald-500/20 text-emerald-300',
  amber: 'bg-amber-500/20 text-amber-300',
  indigo: 'bg-indigo-500/20 text-indigo-300',
  rose: 'bg-rose-500/20 text-rose-300',
  purple: 'bg-purple-500/20 text-purple-300',
  slate: 'bg-white/10 text-slate-300',
};

// A caption is supporting prose ("Lab, X-Ray, Ultrasound & more"), so it is set as text. Only a
// `trend` gets a filled pill, because a delta is a discrete fact worth calling out — giving both
// the same chip treatment made every card look like it was reporting a change when most were not.
const CAPTION_TONE = {
  green: 'text-brand-700',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  indigo: 'text-indigo-700',
  rose: 'text-rose-700',
  purple: 'text-purple-700',
  slate: 'text-slate-500',
};

const TREND_TONE = {
  up: 'text-emerald-700 bg-emerald-50',
  down: 'text-rose-700 bg-rose-50',
};

const MetricCard = ({
  label,
  value,
  icon: Icon,
  tone = 'green',
  captionTone,
  caption,
  trend,
  variant = 'light',
  onClick,
  className = '',
}) => {
  const resolvedCaptionTone = captionTone || tone;
  const isDark = variant === 'dark';
  const clickable = typeof onClick === 'function';
  const Wrapper = clickable ? 'button' : 'div';

  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        // flex column so the figure can be pushed to the bottom: see the label note below. A row
        // of cards is a grid, and grid children stretch, so the cards are already equal height —
        // this makes their numbers share a baseline even when one label wraps and another does not.
        'group relative flex w-full flex-col overflow-hidden rounded-xl border p-3.5 text-left transition-all duration-200 sm:p-4',
        isDark
          ? 'border-white/10 bg-white/[0.06]'
          : 'border-line bg-surface',
        clickable &&
          (isDark
            ? 'cursor-pointer hover:border-white/20 hover:bg-white/[0.1]'
            : 'cursor-pointer hover:-translate-y-px hover:border-brand-300 hover:shadow-raised'),
        className
      )}
    >
      <div className="flex items-center gap-2">
        {/* Hidden below `sm`. These strips are a two-column grid on a phone, so a card is about
            145px wide; the icon and its gap take 36px of that, and what is left cannot hold an
            uppercase label like "PENDING REQUESTS" even across two lines — it clipped to
            "PENDING REQUES". The icon is the decoration and the label is the information, so at
            the width where only one of them fits, it is not the icon. */}
        {Icon && (
          <span
            className={cn(
              'hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg sm:flex',
              isDark ? DARK_ICON_TONE[tone] || DARK_ICON_TONE.slate : ICON_TONE[tone] || ICON_TONE.slate
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        {/* 11px rather than 10px, and tracking pulled back from `widest`. Uppercase text at 10px
            with 0.1em of letter-spacing is the single most common reason a dashboard label is
            skipped rather than read.

            It WRAPS rather than truncating. This was `truncate`, and at phone width a row of
            cards is a two-column grid — about 120px per label once the icon and gaps are taken
            out, which is not enough for eleven uppercase letters with 0.1em of tracking. Every
            console showed the same thing: "COLLECT…", "CASH CO…", "RECEIPTS…", "PENDI…",
            "COMP…". The figure was legible and nothing said what it counted, which is worse than
            a card that is merely tall. Two lines is the cap — past that the label is too long to
            be a label. */}
        <span
          className={cn(
            // break-words as the backstop: a single word longer than the card would otherwise be
            // clipped mid-letter with no ellipsis, which is the worst of both behaviours.
            'min-w-0 break-words text-micro font-semibold uppercase leading-tight tracking-[0.04em] sm:tracking-[0.1em] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden',
            isDark ? 'text-slate-400' : 'text-slate-500'
          )}
        >
          {label}
        </span>
        {clickable && (
          <ArrowUpRight
            aria-hidden="true"
            className={cn(
              'ml-auto h-3.5 w-3.5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100',
              isDark ? 'text-slate-300' : 'text-brand-600'
            )}
          />
        )}
      </div>

      {/* tabular-nums keeps digits on a fixed advance width, so figures line up across a row of
          cards and a counter ticking 9 -> 10 does not shift the layout under the reader. */}
      <div
        className={cn(
          // The number hugs its label — that is the relationship the card exists to state, and
          // pinning the number to the bottom instead opened a hole under every short label while
          // still not aligning it with a neighbour that had a caption. It is the CAPTION that
          // takes mt-auto below, so the cards agree along their bottom edge.
          'mt-2.5 text-stat font-extrabold leading-none tracking-tight tabular-nums break-words',
          isDark ? 'text-white' : 'text-slate-900'
        )}
      >
        {value}
      </div>

      {trend && (
        <span
          className={cn(
            'mt-auto inline-flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 pt-0 text-fine font-semibold',
            isDark ? 'bg-white/10 text-slate-200' : TREND_TONE[trend.direction]
          )}
        >
          {trend.direction === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trend.label}
        </span>
      )}

      {caption && !trend && (
        <span
          className={cn(
            // Also wraps to two lines, for the same reason as the label: "Lab, X-Ray, Ultrasound
            // & more" is a sentence, and an ellipsis two words in tells the reader nothing.
            // mt-auto so a row of cards lines up along the bottom.
            'mt-auto pt-1.5 block text-fine font-medium leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden',
            isDark ? 'text-slate-400' : CAPTION_TONE[resolvedCaptionTone] || CAPTION_TONE.slate
          )}
        >
          {caption}
        </span>
      )}
    </Wrapper>
  );
};

export default MetricCard;
