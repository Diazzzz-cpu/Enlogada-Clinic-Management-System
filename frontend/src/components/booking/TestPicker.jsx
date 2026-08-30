import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SearchInput } from '../ui/search-input';
import { formatCurrency } from '../../lib/currency';
import { AlertTriangle, ChevronRight, Package } from 'lucide-react';

/**
 * Choosing which tests a visit is for. [1.26.0]
 *
 * Extracted so the front desk and the queue use the same control, and so registering a walk-in
 * can attach tests in the same breath. Reception used to register the patient on one screen, then
 * find that patient again in the queue to attach anything — two screens for one interaction, at
 * the busiest moment of the clinic's day, with a real chance of the second half never happening.
 * A visit with no tests reaches the cashier as a zero bill.
 *
 * ── Three things it does that a bare checkbox list does not ───────────────────────────────────
 * It shows a running total, so reception can answer "how much will this be?" at the desk instead
 * of the patient finding out at the till. It groups by department, because a catalogue of fifteen
 * tests in arbitrary order is a scan every single time. And it surfaces the preparation note for
 * anything selected, so the person handing over the queue ticket is the one who says "come back
 * fasting" — which is far more likely to land than an email.
 *
 * ── Packages [1.45.0] ─────────────────────────────────────────────────────────────────────────
 *
 * The clinic sells five fixed-price bundles, and they sit ABOVE the individual tests here for the
 * same reason they lead the printed sheet: a bundle is the cheaper way to buy the same work, and
 * reception should see it before pricing the components one at a time.
 *
 * A package contributes its own fixed price to the running total, not the sum of its parts — that
 * is the whole point of it, and the total at this desk has to be the number the cashier will ask
 * for. Its components' preparation notes still surface below, because a patient booking Package A
 * needs the full-bladder instruction exactly as much as one booking the ultrasound alone.
 */
const TestPicker = ({
  tests = [],
  selectedIds = [],
  onToggle,
  packages = [],
  selectedPackageIds = [],
  onTogglePackage,
  disabled = false,
  maxHeight = 'max-h-72',
}) => {
  const [query, setQuery] = useState('');

  /**
   * Which departments are open. [1.54.0]
   *
   * All 65 services used to render expanded inside one 224px scroll box, so booking an X-ray
   * meant scrolling past every blood test in the catalogue. Collapsed by default, a department is
   * one click and the list is four lines instead of sixty-five.
   *
   * A Set of the OPEN ones rather than a boolean per category: categories come from the database
   * and this must not need editing when the clinic adds one.
   */
  const [openCategories, setOpenCategories] = useState(() => new Set());

  /**
   * The first department opens itself, once.
   *
   * Collapsed-everything is right for browsing and wrong for working: reception attaches tests at
   * the counter dozens of times a day, and making them click a header before they can see a single
   * checkbox adds a step to the busiest workflow in the clinic. One department open is a usable
   * list that is still four lines rather than sixty-five.
   *
   * Guarded by a ref rather than by `openCategories.size === 0`, because the two are different
   * questions: the second would re-open the department the moment someone deliberately closed the
   * last open one, which is a control fighting the person using it.
   */
  const autoOpened = useRef(false);
  const [openPackages, setOpenPackages] = useState(() => new Set());
  const togglePackageDetail = (id) =>
    setOpenPackages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleCategory = (name) =>
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = term
      ? tests.filter((t) => `${t.name} ${t.category_name}`.toLowerCase().includes(term))
      : tests;

    const byCategory = new Map();
    for (const t of matching) {
      const key = t.category_name || 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(t);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tests, query]);

  const searching = query.trim().length > 0;

  useEffect(() => {
    if (autoOpened.current || grouped.length === 0) return;
    autoOpened.current = true;
    setOpenCategories(new Set([grouped[0][0]]));
  }, [grouped]);

  const selected = tests.filter((t) => selectedIds.includes(t.id.toString()));
  const selectedPackages = packages.filter((p) => selectedPackageIds.includes(p.id.toString()));

  // The package contributes its fixed price, never the sum of its components.
  const total =
    selected.reduce((sum, t) => sum + parseFloat(t.price || 0), 0) +
    selectedPackages.reduce((sum, p) => sum + parseFloat(p.price || 0), 0);

  // Preparation from both, de-duplicated by test id: booking Package A and a Pelvic Ultrasound
  // separately must not print the same "do not empty your bladder" line twice.
  const preparation = useMemo(() => {
    const byId = new Map();
    for (const t of selected) if (t.preparation) byId.set(t.id, t);
    for (const p of selectedPackages) {
      for (const t of p.tests || []) if (t.preparation) byId.set(t.id, t);
    }
    return [...byId.values()];
  }, [selected, selectedPackages]);

  return (
    <div className="space-y-2">
      {/* Only once the catalogue is long enough that scanning it is work. */}
      {tests.length > 8 && (
        <SearchInput
          placeholder="Filter tests…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
      )}

      {/* Packages lead, as they do on the clinic's own sheet. Outside the scrolling list so a
          bundle is never scrolled past on the way to pricing its parts individually. */}
      {packages.length > 0 && (
        <div className="space-y-1.5">
          <p className="m-0 px-1 text-micro font-semibold uppercase tracking-[0.08em] text-slate-500">
            Package deals
          </p>
          {packages.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-azure-200 bg-azure-50/50 transition-colors hover:border-azure-300">
              {/* ONE line per bundle. [1.54.0] Spelling out every component inline, five packages
                  of six-to-nine tests each filled the picker before the individual list began —
                  which is the "scroll past everything to reach the tests" complaint. Name, size
                  and price on one row keeps every bundle visible, because a package is the cheaper
                  way to buy the same work and has to stay discoverable; the components are one
                  click away for the patient who wants to check what is covered.

                  The disclosure control is a SIBLING of the label, not a child: a <button> inside
                  a <label> also toggles that label's checkbox, so opening the details would have
                  silently added the package to the booking. */}
              <div className="flex items-center gap-2 pr-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-2.5">
                  <input
                    type="checkbox"
                    checked={selectedPackageIds.includes(p.id.toString())}
                    onChange={() => onTogglePackage?.(p.id.toString())}
                    disabled={disabled}
                    className="rounded text-azure-600 focus:ring-azure-500"
                  />
                  <Package className="h-3.5 w-3.5 flex-shrink-0 text-azure-600" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">
                    {p.name}
                    <span className="ml-1.5 font-medium text-slate-500">
                      · {(p.tests || []).length} tests
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-xs font-extrabold tabular-nums text-azure-700">
                    {formatCurrency(p.price)}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => togglePackageDetail(p.id.toString())}
                  aria-expanded={openPackages.has(p.id.toString())}
                  aria-label={`What is included in ${p.name}`}
                  className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-azure-600 transition-colors hover:bg-azure-100"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${openPackages.has(p.id.toString()) ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="disclosure" data-open={openPackages.has(p.id.toString())}>
                <div>
                  <p
                    inert={!openPackages.has(p.id.toString())}
                    className="m-0 border-t border-azure-200/70 px-2.5 py-1.5 text-fine leading-snug text-slate-600"
                  >
                    {(p.tests || []).map((t) => t.name).join(', ')}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`${maxHeight} space-y-3 overflow-y-auto rounded-xl border border-line bg-slate-50/70 p-3`}>
        {grouped.length === 0 ? (
          <p className="m-0 py-3 text-center text-fine text-slate-400">No test matches that.</p>
        ) : (
          grouped.map(([category, items]) => {
            // Searching forces every department open. A filter that leaves its own matches hidden
            // behind a collapsed header reads as "no results" — the search would be lying.
            const open = searching || openCategories.has(category);
            const chosen = items.filter((t) => selectedIds.includes(t.id.toString())).length;
            const panelId = `testpicker-${category.replace(/\W+/g, '-').toLowerCase()}`;

            return (
              <div key={category} className="overflow-hidden rounded-lg border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  disabled={searching}
                  className="flex w-full cursor-pointer items-center gap-2 border-0 bg-surface px-2.5 py-2 text-left transition-colors hover:bg-slate-50 disabled:cursor-default"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-micro font-semibold uppercase tracking-[0.08em] text-slate-600">
                    {category}
                  </span>
                  {/* How many are picked in here, so a COLLAPSED department still reports itself.
                      Without it, closing a section hides the fact that you chose something in it. */}
                  {chosen > 0 && (
                    <span className="rounded-md bg-brand-100 px-1.5 py-px text-micro font-bold tabular-nums text-brand-700">
                      {chosen} picked
                    </span>
                  )}
                  <span className="text-micro font-medium tabular-nums text-slate-400">{items.length}</span>
                </button>

                {/* Always rendered, height-animated. Unmounting on close is instant and jarring,
                    and it also throws away the checkbox DOM every time a department is collapsed. */}
                <div className="disclosure" data-open={open}>
                  <div>
                    {/* inert, not hidden. `hidden` is display:none, which removes the height the
                        animation needs to travel to — the section would jump rather than open.
                        `inert` leaves the layout intact and takes the checkboxes out of the tab
                        order and the accessibility tree, which is the part that actually matters
                        when a collapsed section is still in the DOM. */}
                    <div id={panelId} inert={!open} className="space-y-1 border-t border-line p-2">
                    {items.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface p-2 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(t.id.toString())}
                          onChange={() => onToggle(t.id.toString())}
                          disabled={disabled}
                          className="rounded text-brand-600 focus:ring-brand-500"
                        />
                        <span className="flex flex-1 items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">{t.name}</span>
                          <span className="font-extrabold tabular-nums text-slate-900">{formatCurrency(t.price)}</span>
                        </span>
                      </label>
                    ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* The running total. Reception can quote it across the desk rather than the patient
          discovering the number at the till. */}
      <div className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2">
        <span className="text-fine font-medium text-slate-500">
          {selected.length === 0 && selectedPackages.length === 0
            ? 'Nothing selected'
            : [
                selectedPackages.length
                  ? `${selectedPackages.length} package${selectedPackages.length === 1 ? '' : 's'}`
                  : null,
                selected.length
                  ? `${selected.length} test${selected.length === 1 ? '' : 's'}`
                  : null,
              ].filter(Boolean).join(' + ') + ' selected'}
        </span>
        <span className="text-note font-extrabold tabular-nums text-slate-900">{formatCurrency(total)}</span>
      </div>

      {/* Preparation, at the desk. The person handing over the queue ticket saying "come back
          fasting" lands far better than the same sentence in an email. */}
      {preparation.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
          <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-amber-900">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            Tell the patient before they leave
          </p>
          <ul className="m-0 list-disc space-y-0.5 pl-5 text-fine leading-relaxed text-amber-800">
            {preparation.map((t) => (
              <li key={t.id}><strong>{t.name}</strong> — {t.preparation}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default TestPicker;
