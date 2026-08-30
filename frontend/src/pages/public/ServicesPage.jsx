import React, { useState, useEffect, useMemo } from 'react';
import LoadingState from '../../components/ui/loading-state';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageShell from '../../components/ui/page-shell';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import { Activity, Stethoscope, FileText, Zap, Search, Info, Phone, CalendarCheck, X, Package, Check } from 'lucide-react';
import { categoryKey, categoryTint } from '../../lib/categories';
import { useClinic } from '../../lib/clinic';

/**
 * The public price list — the one page a stranger judges the clinic by.
 *
 * ── Why the layout changed ────────────────────────────────────────────────────────────────────
 *
 * It was a three-column grid of category cards, one card per department. That shape fights the
 * data: Laboratory carries 20+ tests and ECG carries one, so the row rendered a wall of text
 * beside a card that was 90% empty space, and the page's first impression was "unfinished".
 * Column height was decided by whichever department happened to have the most tests, which is
 * not a design decision anybody made.
 *
 * Each department is a full-width section now, and its tests flow in a responsive grid inside it.
 * A one-test department is one tidy row; a twenty-test department is a block. Neither distorts
 * the other, at any width.
 *
 * ── The search box ────────────────────────────────────────────────────────────────────────────
 *
 * This list is 25+ items and somebody arriving here usually wants one specific test and its
 * price. Scrolling five sections to find "Creatinine" is the actual task, and it had no support.
 */
const ServicesPage = ({ onNavigate }) => {
  // The live identity, not the frozen defaults — the clinic may have configured a different
  // number, and the whole value of showing one here is that somebody can actually ring it.
  const CLINIC = useClinic();
  const [categories, setCategories] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  // The public catalogue, on the page a prospective patient reads to decide whether to come at
  // all. A failed fetch used to stop at console.error and fall through to "No Active Services" —
  // telling a stranger this clinic offers nothing, which is the worst possible thing for the one
  // page that has to win them over. It is also the only page with no account behind it, so
  // nobody internal would ever see it fail.
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await api.get('/tests');
        const tests = response.data.data.tests || [];

        const groupedMap = {};
        tests.forEach((test) => {
          const catName = test.category_name || 'General Diagnostics';
          if (!groupedMap[catName]) groupedMap[catName] = [];
          groupedMap[catName].push(test);
        });

        setCategories(Object.keys(groupedMap).map((catName) => ({
          title: catName,
          items: groupedMap[catName],
        })));

        // Fetched separately and allowed to fail on its own: the packages are an addition to the
        // price list, not a precondition for it. A patient who cannot see the bundles can still
        // read every individual price, which is the page's actual job.
        try {
          const pkgRes = await api.get('/packages');
          setPackages(pkgRes.data.data.packages || []);
        } catch {
          setPackages([]);
        }
      } catch (err) {
        console.error('Failed to fetch services:', err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  // Icon per category is this page's own business; the COLOUR is not. It came from a second,
  // independent map that disagreed with the report chart on all five categories — Xray was
  // indigo here and amber there — so a patient browsing services and a manager reading a report
  // saw the same five things in two unrelated schemes. lib/categories is the single source now.
  const CATEGORY_ICONS = {
    Laboratory: Activity,
    Ultrasound: Stethoscope,
    Xray: FileText,
    ECG: Zap,
  };

  const getCategoryMeta = (title) => ({
    icon: CATEGORY_ICONS[categoryKey(title)] || Activity,
    bg: categoryTint(title),
  });

  // Filtering keeps the section structure and drops the sections that come out empty, rather than
  // flattening into one undifferentiated result list — which department a test belongs to is
  // useful context, and it is what tells the reader where in the clinic they will be sent.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({ ...cat, items: cat.items.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, query]);

  const totalShown = visible.reduce((n, c) => n + c.items.length, 0);
  const totalAll = categories.reduce((n, c) => n + c.items.length, 0);
  const hasCatalogue = !loading && !loadError && totalAll > 0;

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <PublicHeader currentTab="services" onNavigate={onNavigate} />

      {/* Hero. The shared rail-gradient/rail-grid treatment, so this banner is the same surface as
          Home, About and the sign-in panel rather than a flat navy slab of its own. */}
      <section className="rail-gradient rail-grid relative overflow-hidden">
        <PageShell className="relative z-10 py-12 sm:py-16">
          <p className="m-0 text-meta font-semibold uppercase tracking-[0.18em] text-azure-300">
            Price list
          </p>
          <h1 className="mt-2.5 mb-0 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            Our Services
          </h1>
          <p className="mt-3 mb-0 max-w-2xl text-sm leading-relaxed text-rail-ink-soft">
            Every diagnostic test we offer, with its price and how to prepare for it. No account
            needed — and the prices below are the ones charged at the counter.
          </p>

          {/* Search sits in the hero because finding one test is the actual task, and the hero is
              where the eye already is. */}
          {hasCatalogue && (
            <>
              <div className="mt-7 flex max-w-xl items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 backdrop-blur-sm transition-colors focus-within:border-azure-300/70 focus-within:bg-white/15">
                <Search className="h-4 w-4 flex-shrink-0 text-slate-300" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search services by name"
                  placeholder="Search a test — CBC, ultrasound, ECG…"
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-white/10 text-slate-300 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <p className="mt-3 mb-0 text-fine text-slate-400">
                {query
                  ? `${totalShown} of ${totalAll} services match your search`
                  : `${totalAll} services across ${categories.length} departments`}
              </p>
            </>
          )}
        </PageShell>
      </section>

      <main className="flex-1 w-full">
        <PageShell className="py-10 sm:py-14">
          {loading ? (
            <LoadingState size="lg" label="Loading services…" className="py-24" />
          ) : loadError ? (
            /* Deliberately says the list could not load and gives the clinic's phone number,
               rather than reporting an empty catalogue. A visitor who cannot see the price list
               can still ring up, which is the whole point of the page. */
            <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-rose-200 bg-surface p-10 text-center">
              <h3 className="m-0 text-lg font-bold text-rose-800">Our service list is unavailable</h3>
              <p className="m-0 text-note leading-relaxed text-rose-700">
                This is a problem on our side, not a sign that we are closed. Please try again in a
                moment, or call us on <strong>{CLINIC.phone}</strong>.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 cursor-pointer rounded-lg border border-rose-200 bg-surface px-3 py-1.5 text-fine font-semibold text-rose-800 transition-colors hover:bg-rose-50"
              >
                Try again
              </button>
            </div>
          ) : categories.length === 0 ? (
            <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-line bg-surface p-10 text-center">
              <h3 className="m-0 text-lg font-bold text-slate-800">No Active Services</h3>
              <p className="m-0 text-fine text-slate-500">
                Diagnostic services will appear here once added by clinic administration.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-line bg-surface p-10 text-center">
              <h3 className="m-0 text-lg font-bold text-slate-800">Nothing matches that search</h3>
              <p className="m-0 text-fine leading-relaxed text-slate-500">
                Try a shorter word, or call us on <strong>{CLINIC.phone}</strong> and we will tell
                you whether we run it.
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-2 cursor-pointer rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-fine font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-12">
              {/* Packages first, because that is how the clinic's own sheet leads and because a
                  bundle is the cheaper way to buy the same work. Hidden while a search is running:
                  the search is for finding one named test, and a package is not one. */}
              {!query && packages.length > 0 && (
                <section aria-labelledby="packages-heading">
                  <div className="mb-5 flex items-center gap-3 border-b border-line pb-3.5">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-azure-100 text-azure-700">
                      <Package className="h-5 w-5" />
                    </span>
                    <h2 id="packages-heading" className="m-0 text-xl font-bold tracking-tight text-slate-900">
                      Package Deals
                    </h2>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-meta font-semibold text-slate-500">
                      {packages.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {packages.map((pkg) => {
                      // What the same tests cost bought one at a time. Shown only when it is a
                      // real saving — a "save ₱0" badge, or a negative one, advertises the
                      // opposite of what it is trying to say.
                      const listTotal = pkg.tests.reduce((sum, t) => sum + Number(t.price || 0), 0);
                      const saving = listTotal - Number(pkg.price);
                      return (
                      <article
                        key={pkg.id}
                        className="flex flex-col rounded-xl border border-azure-200 bg-azure-50/40 p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-azure-300 hover:shadow-raised"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="m-0 text-base font-bold tracking-tight text-slate-900">
                            {pkg.name}
                          </h3>
                          <span className="flex-shrink-0 whitespace-nowrap text-lg font-extrabold tabular-nums text-azure-700">
                            {formatCurrency(pkg.price)}
                          </span>
                        </div>

                        {saving > 0 && (
                          <p className="m-0 mt-1.5 text-fine font-semibold text-brand-700">
                            Save {formatCurrency(saving)} against booking these separately
                          </p>
                        )}

                        <ul className="m-0 mt-3.5 list-none space-y-1.5 p-0">
                          {pkg.tests.map((t) => (
                            <li key={t.id} className="flex items-start gap-2 text-fine leading-relaxed text-slate-600">
                              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                              <span>{t.name}</span>
                            </li>
                          ))}
                        </ul>
                      </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {visible.map((cat) => {
                const meta = getCategoryMeta(cat.title);
                const Icon = meta.icon;
                return (
                  <section key={cat.title} aria-labelledby={`cat-${categoryKey(cat.title)}`}>
                    {/* Department header. A hairline under it separates the section without boxing
                        it — a bordered, shadowed card around a whole department is what made the
                        old page read as five disconnected widgets. */}
                    <div className="mb-5 flex items-center gap-3 border-b border-line pb-3.5">
                      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${meta.bg}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <h2
                        id={`cat-${categoryKey(cat.title)}`}
                        className="m-0 text-xl font-bold tracking-tight text-slate-900"
                      >
                        {cat.title}
                      </h2>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-meta font-semibold text-slate-500">
                        {cat.items.length}
                      </span>
                    </div>

                    {/* The grid that fixes the old layout: tests flow, so a one-test department is
                        one row and a twenty-test one is a block. */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {cat.items.map((item) => (
                        <article
                          key={item.id}
                          className="flex flex-col rounded-xl border border-line bg-surface p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-azure-200 hover:shadow-raised"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="m-0 text-note font-semibold leading-snug text-slate-800">
                              {item.name}
                            </h3>
                            <span className="flex-shrink-0 whitespace-nowrap text-lead font-bold tabular-nums text-azure-700">
                              {formatCurrency(item.price)}
                            </span>
                          </div>

                          {/* What the patient has to do beforehand, on the page they read BEFORE
                              booking. [1.24.0] put this on the booking picker, the confirmation
                              and the day-before reminder — all of which happen after somebody has
                              already decided. "Nothing to eat for 8 hours" is the kind of thing
                              that decides whether you book a morning slot, and this is the only
                              screen a person reads while they are still deciding. */}
                          {item.preparation && (
                            <p className="m-0 mt-2.5 flex items-start gap-1.5 border-t border-line pt-2.5 text-fine leading-relaxed text-slate-500">
                              <Info className="mt-px h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
                              <span>{item.preparation}</span>
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </PageShell>

        {/* Closing call to action. The page answers "what do you offer and what does it cost";
            without this it never answers "so what do I do now". */}
        {hasCatalogue && (
          <PageShell className="pb-14">
            <div className="rail-gradient rail-grid relative overflow-hidden rounded-2xl px-6 py-8 sm:px-10 sm:py-10">
              <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="m-0 text-xl font-bold tracking-tight text-white sm:text-2xl">
                    Ready to book?
                  </h2>
                  <p className="mt-1.5 mb-0 text-note leading-relaxed text-rail-ink-soft">
                    Reserve a slot online, or walk in during clinic hours — we take both.
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onNavigate?.('register')}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-0 bg-azure-500 px-4 py-2.5 text-note font-semibold text-white transition-colors hover:bg-azure-600"
                  >
                    <CalendarCheck className="h-4 w-4" />
                    Book online
                  </button>
                  <a
                    href={`tel:${CLINIC.phone.replace(/\s/g, '')}`}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-note font-semibold text-white no-underline transition-colors hover:bg-white/15"
                  >
                    <Phone className="h-4 w-4" />
                    {CLINIC.phone}
                  </a>
                </div>
              </div>
            </div>
          </PageShell>
        )}
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default ServicesPage;
