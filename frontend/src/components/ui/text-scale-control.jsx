import React, { useEffect, useRef, useState } from 'react';
import { ALargeSmall, Check } from 'lucide-react';
import { TEXT_SCALES, setTextScale, useTextScale } from '../../lib/textScale';
import { cn } from '../../lib/utils';

/**
 * Lets whoever is reading the screen choose how large the text is.
 *
 * A clinic is the setting where this earns its place: reception runs one screen for a full shift,
 * some staff work at arm's length from a counter monitor, and the portal is read by people who
 * came in for a diagnostic test. Browser zoom is the usual answer and a poor one — it reflows the
 * layout, it is per-site rather than per-person on a shared terminal, and nobody finds it.
 *
 * ── Why this is one button and not three ──────────────────────────────────────────────────────
 *
 * It shipped as a visible segmented control — an icon and three `A`s in a bordered box — and it
 * was wrong on a public page in a way that is obvious in a screenshot: a utility toggle sitting at
 * full strength in a marketing header, competing with the navigation and the primary call to
 * action for the same attention. An accessibility affordance should be easy to find when wanted
 * and quiet when not; four glyphs in a box is neither.
 *
 * So it collapses to a single icon button that opens a small menu. Same three choices, same one
 * click to reach them, none of the visual weight when nobody is looking for it.
 */
const TextScaleControl = ({ className, tone = 'light' }) => {
  const active = useTextScale();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const dark = tone === 'dark';

  // Dismiss on an outside click or Escape — the two things anybody tries first.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const current = TEXT_SCALES.find((s) => s.id === active) || TEXT_SCALES[0];

  return (
    <div ref={wrap} className={cn('relative', className)} data-testid="text-scale">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Text size: ${current.label}`}
        title="Text size"
        className={cn(
          'flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition-colors',
          dark
            ? 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            : 'border-slate-200 bg-surface text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800',
          open && (dark ? 'bg-white/10 text-white' : 'border-slate-300 bg-slate-50 text-slate-800')
        )}
      >
        <ALargeSmall className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Text size"
          className="animate-fade-in absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-float"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">
            Text size
          </p>
          {TEXT_SCALES.map((scale, i) => {
            const selected = scale.id === active;
            return (
              <button
                key={scale.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                // The accessible name stays a plain, stable string so it can be targeted and read
                // out regardless of how the row is drawn.
                aria-label={`${scale.label} text size`}
                onClick={() => { setTextScale(scale.id); setOpen(false); }}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-0 px-2.5 py-2 text-left transition-colors',
                  selected ? 'bg-azure-50 text-azure-700' : 'bg-transparent text-slate-700 hover:bg-slate-50'
                )}
              >
                {/* The row is drawn at the size it selects, so the choice previews itself. Pinned
                    in px rather than rem: this is a specimen of a size, not text that should
                    itself grow when the setting changes. */}
                <span style={{ fontSize: `${13 + i * 2}px` }} className="font-semibold leading-none">
                  {scale.label}
                </span>
                {selected && <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TextScaleControl;
