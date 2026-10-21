import React, { useEffect, useState } from 'react';
import { Activity, Calendar, CheckCircle, Clock, Eye, FileText, FlaskConical, Scan, Search, Stethoscope } from 'lucide-react';

// The mark a patient recognises their own report by. Elements rather than components because
// they are looked up by name and rendered as-is; the sizing is the same everywhere it appears.
const CATEGORY_ICONS = {
  Ultrasound: <Stethoscope className="w-5 h-5" />,
  Xray: <Scan className="w-5 h-5" />,
  Laboratory: <FlaskConical className="w-5 h-5" />,
  ECG: <Activity className="w-5 h-5" />,
};
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import EmptyState from '../ui/empty-state';
import { SkeletonList } from '../ui/skeleton';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import { SearchInput } from '../ui/search-input';
import { Dialog, DialogContent, DialogTrigger } from '../ui/dialog';
import { StatusBadge } from '../ui/status-badge';
import ResultReport from '../ResultReport';
import Pagination from '../ui/pagination';
import { categoryLabel, issuesReports } from '../../lib/categories';
import { visitOrigin } from '../../lib/visitOrigin';

const LIST_PAGE_SIZE = 8;

/**
 * The diagnostic reports this patient can read.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 *
 * Plain content, not a `TabsContent`: ClientDashboard already wraps each tab in one, and a
 * second one inside it made two tab panels answering to one tab. [1.80.0]
 *
 * One panel with a row per test, under the search and the department filters. [1.82.0] It was a
 * card per test, each with its own border and hover lift, under a toolbar that repeated the tab's
 * name ("Diagnostic History" beneath "Results").
 */
export default function ResultsTab({ profiles, results, onPreviewDocument }) {
  // A patient's tests accumulate visit after visit, so the list pages like Appointments and
  // Payments do [1.128.0], and goes back to the first page when the search or department changes.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [results.search, results.category]);
  const totalPages = Math.max(1, Math.ceil(results.filtered.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = results.filtered.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  const patientName = `${profiles.selected?.first_name || ''} ${profiles.selected?.last_name || ''}`.trim();

  return (
        <div>
          <Toolbar attached>
            <SearchInput
              placeholder="Search test..."
              value={results.search}
              onChange={e => results.setSearch(e.target.value)}
              containerClassName="w-full sm:w-56"
            />
            <ToolbarSpacer />
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {/* Only the categories this patient actually has. The hardcoded list this
                  replaced mirrored all five test_categories rows, so every patient was offered
                  filters for services the clinic does not offer — chips that
                  named a service nobody can book and returned nothing when clicked. */}
              {results.categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => results.setCategory(cat)}
                  className={`cursor-pointer rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                    results.category === cat
                      ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                      : 'bg-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </Toolbar>

          <Panel className="overflow-hidden rounded-t-none">
            <PanelBody flush>
              {results.error ? (
                // tone="error" looks deliberately unlike empty. A patient who has just been
                // emailed "your result is ready" and then reads "no diagnostic requests found"
                // concludes the clinic lost it.
                <EmptyState
                  tone="error"
                  title="Your results could not be loaded"
                  description={results.error}
                  action={<Button variant="outline" size="sm" onClick={results.reload}>Try again</Button>}
                />
              ) : results.loading ? (
                <div className="p-4"><SkeletonList rows={3} /></div>
              ) : results.history.length === 0 ? (
                <EmptyState
                  compact
                  icon={FileText}
                  title="No tests yet"
                  description="Each test you book is listed here with its status, and its report once the clinic releases it."
                />
              ) : results.filtered.length === 0 ? (
                <EmptyState
                  compact
                  icon={Search}
                  title="Nothing matches"
                  description="Try another department, or clear the search."
                />
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {paged.map(item => (
                    <li
                      key={item.visit_test_id}
                      className="flex flex-col items-start justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
                    >
                      <div className="flex min-w-0 items-start gap-3.5">
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-line bg-slate-50 text-brand-600">
                          {CATEGORY_ICONS[item.category_name] || <FlaskConical className="w-5 h-5" />}
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-meta font-bold uppercase tracking-wider text-ink-muted">REQ-{item.visit_test_id}</span>
                            <StatusBadge status={item.test_status} className="text-meta px-2 py-0.5" />
                          </div>
                          <p className="m-0 text-sm font-bold text-ink">
                            {item.category_name} - {item.test_name}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fine text-ink-muted">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                              {new Date(item.visit_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              {new Date(item.visit_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}
                            </span>
                            {/* How the visit came about, once, in the date line. [1.136.0] */}
                            {visitOrigin(item) && (
                              <span data-testid="visit-origin" data-origin={visitOrigin(item).key}>
                                {visitOrigin(item).label}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!issuesReports(item.category_name) && !item.file_path ? (
                        // X-ray [1.129.0]: its results come from the X-ray department's own system,
                        // so there is nothing here to open, and "not released yet" would wait forever.
                        <p className="m-0 flex max-w-xs items-start gap-1.5 text-fine text-slate-500">
                          <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          <span>
                            {item.test_status === 'Completed' ? 'Done. ' : ''}
                            Your {categoryLabel(item.category_name)} result is given by the {categoryLabel(item.category_name)} department, not in this portal.
                          </span>
                        </p>
                      ) : item.test_status === 'Completed' ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="flex-shrink-0">
                              <CheckCircle className="h-4 w-4" aria-hidden="true" />
                              View report
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">

                          {/* The patient's copy — the SAME component the clinic's copy uses. The
                              requirement is that staff record findings once and the saved result is
                              what gets printed; two renderings could only ever agree by coincidence,
                              and these two already did not. */}
                          <ResultReport
                            result={item}
                            patientName={patientName}
                            variant="patient"
                          >
                              {item.file_path && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                                  <span className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-brand-600" />
                                    <span className="text-fine font-semibold text-slate-800">
                                      {item.file_original_name || 'Attached report'}
                                    </span>
                                  </span>
                                  {/* View only. [1.113.0] [1.115.0] A released report is not offered as
                                      a download or a print in the portal: the original is handed over at
                                      the clinic, and a copy is emailed on request. */}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    onClick={() => onPreviewDocument({
                                      visitTestId: item.visit_test_id,
                                      testName: item.test_name,
                                      patientName,
                                      fileName: item.file_original_name,
                                    })}
                                  >
                                    <Eye className="h-3 w-3" />
                                    View Report
                                  </Button>
                                </div>
                              )}
                          </ResultReport>

                          {/* No "Print official copy" here. [1.114.0] It printed this letterhead
                              page, not the report, and called it official; the official copy is
                              the original at the clinic. */}

                          </DialogContent>
                        </Dialog>
                      ) : item.test_status !== 'Cancelled' && (
                        // Not released, so there is nothing to open yet. This was a "Details" button
                        // with no handler: pressed, it did nothing, which reads as broken. [1.80.0]
                        <p className="m-0 flex max-w-xs items-start gap-1.5 text-fine text-slate-500">
                          <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                          <span>Not released yet. It will appear here once the clinic releases it.</span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
            {!results.error && results.filtered.length > 0 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={setPage}
                total={results.filtered.length}
                pageSize={LIST_PAGE_SIZE}
              />
            )}
          </Panel>
        </div>
  );
}
