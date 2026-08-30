import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileClock, History, ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import LoadingState from '../ui/loading-state';
import FindingsText from './FindingsText';
import { formatDateTime } from '../../lib/date';

/**
 * What this report used to say, and why it changed. [1.63.0]
 *
 * ── The question this answers ───────────────────────────────────────────────────────────────
 *
 * A referring doctor rings up: "this says something different from the copy I have." Until now the
 * only way to answer was to read the database. `[1.15.0]` had recorded everything needed — each
 * superseded version, its findings, its amendment reason and the clinician who released it — and
 * nothing in the app displayed any of it.
 *
 * ── Newest first, and the current one is unmistakable ───────────────────────────────────────
 *
 * The live report is what somebody is acting on, so it leads and carries the only solid badge.
 * Superseded versions are dimmed and struck through in the header, because the failure mode here
 * is a clinician reading an old value and believing it — which is worse than not finding it at
 * all. `is_current` comes from the server rather than being inferred from position: the two agree
 * today, and a chain is exactly the sort of thing that later grows an out-of-order row.
 *
 * ── The amendment reason is the point ───────────────────────────────────────────────────────
 *
 * `[1.15.0]` made a reason mandatory on an amendment. It is the medico-legal artefact — the record
 * of WHY a released clinical document was re-issued — so it is shown at full contrast rather than
 * folded away behind the expander.
 *
 * It sits on the version that INTRODUCED the change, not on the one that was replaced: a reason is
 * given when an amendment is made, so v3 carries "why v3 exists" and the original v1 carries none.
 * Reading it as "why this version was superseded" would attach every reason to the wrong report.
 *
 * The superseded FINDINGS are behind the expander, deliberately: they are the dangerous half. A
 * reader should have to ask for a value that is no longer true.
 */

const VersionEntry = ({ version, isLatest }) => {
  // The current version's findings are already rendered in full above this timeline, so it opens
  // collapsed. A superseded one is the reason somebody came here — but still behind one click.
  const [open, setOpen] = useState(false);
  const current = Boolean(version.is_current);

  return (
    <li className="relative pl-6">
      {/* The rail dot. `aria-hidden` — the badge below carries the state for a screen reader. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-2',
          current ? 'bg-brand-600 ring-brand-100' : 'bg-slate-300 ring-slate-100'
        )}
      />

      <div className={cn('space-y-1', !current && 'opacity-80')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-note font-bold', current ? 'text-ink' : 'text-ink-muted line-through')}>
            Version {version.version}
          </span>

          {current ? (
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-brand-800 ring-1 ring-inset ring-brand-200">
              Current
            </span>
          ) : (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-ink-muted ring-1 ring-inset ring-slate-200">
              Superseded
            </span>
          )}

          {version.is_critical && (
            // Colour plus a glyph plus the word, as everywhere else — a critical flag is the last
            // thing that should depend on a reader distinguishing two pale rectangles.
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-rose-800 ring-1 ring-inset ring-rose-200">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              Critical
            </span>
          )}
        </div>

        <p className="m-0 text-fine text-ink-muted">
          {version.released_at ? formatDateTime(version.released_at) : 'Not yet released'}
          {version.released_by_first_name && (
            <> · released by {version.released_by_first_name} {version.released_by_last_name}</>
          )}
          {version.recorded_by_first_name && (
            <> · recorded by {version.recorded_by_first_name} {version.recorded_by_last_name}</>
          )}
        </p>

        {/* Why it was re-issued. Full contrast, never collapsed — this is the record that a
            released clinical document was changed, and the reason it was. */}
        {version.amendment_reason && (
          <p className="m-0 rounded-md bg-amber-50 px-2 py-1.5 text-fine leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
            <span className="font-semibold">Reason for amendment: </span>
            {version.amendment_reason}
          </p>
        )}

        {version.findings && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-fine font-semibold text-azure-700 hover:text-azure-800"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {open ? 'Hide' : 'Show'} what {isLatest ? 'this version' : 'it'} said
            </button>

            {open && (
              <div
                className={cn(
                  'mt-1 rounded-lg border p-2.5 text-fine leading-relaxed',
                  current ? 'border-line bg-sunken text-ink' : 'border-slate-200 bg-slate-50 text-ink-soft'
                )}
              >
                {!current && (
                  // Stated on the content itself, not only on the header above it. Somebody who
                  // scrolled straight to an expanded block needs to know what they are reading.
                  <p className="m-0 mb-1.5 text-micro font-bold uppercase tracking-wide text-ink-muted">
                    Superseded — do not act on this
                  </p>
                )}
                <FindingsText findings={version.findings} />
                {version.remarks && (
                  <p className="m-0 mt-2 border-t border-line-soft pt-2 whitespace-pre-wrap">
                    <span className="font-semibold">Remarks: </span>{version.remarks}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
};

/**
 * @param {object} props
 * @param {Array} props.versions  Newest first, as the endpoint returns them.
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 */
const VersionTimeline = ({ versions, loading, error }) => {
  if (loading) return <LoadingState size="sm" label="Loading amendment history…" />;

  if (error) {
    // Named rather than rendered as an empty timeline. "No amendments" and "we could not check"
    // are different statements about a clinical record.
    return (
      <p className="m-0 flex items-center gap-1.5 text-fine text-amber-900">
        <FileClock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  }

  // One version is not a history. A first issue renders nothing rather than a one-item timeline
  // announcing that a report has never been amended, which is the normal case and not news.
  if (!versions || versions.length < 2) return null;

  return (
    <section className="no-print mt-3 rounded-xl border border-line bg-surface p-3">
      <h3 className="m-0 mb-2 flex items-center gap-1.5 text-fine font-bold uppercase tracking-wide text-ink-muted">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        Amendment history
        <span className="font-normal normal-case tracking-normal">
          — {versions.length} versions of this report
        </span>
      </h3>

      {/* The connecting rail. Decorative, so the dots are aria-hidden and the state is carried by
          the badges. */}
      <ol className="relative m-0 list-none space-y-3 p-0 before:absolute before:bottom-2 before:left-[0.3125rem] before:top-2 before:w-px before:bg-line">
        {versions.map((v, i) => (
          <VersionEntry key={v.id ?? v.version} version={v} isLatest={i === 0} />
        ))}
      </ol>
    </section>
  );
};

export default VersionTimeline;
