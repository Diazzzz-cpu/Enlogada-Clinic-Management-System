import React from 'react';
import { Activity, Calendar, CheckCircle, ChevronRight, Clock, Download, Eye, FileText, FlaskConical, HeartPulse, Info, Printer, Scan, Stethoscope } from 'lucide-react';

// The mark a patient recognises their own report by. Elements rather than components because
// they are looked up by name and rendered as-is; the sizing is the same everywhere it appears.
const CATEGORY_ICONS = {
  Ultrasound: <Stethoscope className="w-5 h-5" />,
  Xray: <Scan className="w-5 h-5" />,
  Laboratory: <FlaskConical className="w-5 h-5" />,
  '2D Echo': <HeartPulse className="w-5 h-5" />,
  ECG: <Activity className="w-5 h-5" />,
};
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import { SearchInput } from '../ui/search-input';
import { Dialog, DialogContent, DialogTrigger } from '../ui/dialog';
import { StatusBadge } from '../ui/status-badge';
import { TabsContent } from '../ui/tabs';
import ResultReport from '../ResultReport';
import { printReport } from '../../lib/printReport';
import { isSafeResultUrl, downloadResultFile } from '../../lib/resultFile';

/**
 * The diagnostic reports this patient can read.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function ResultsTab({ profiles, results, onPreviewDocument }) {
  return (
        <TabsContent value="results" className="m-0 space-y-4">

          {/* Filter & Search Header */}
          <Toolbar>
            <span className="flex items-center gap-2 text-note font-semibold text-slate-900">
              <Activity className="h-4 w-4 text-brand-600" />
              Diagnostic History
            </span>
            <ToolbarSpacer />
            <SearchInput
              placeholder="Search test..."
              value={results.search}
              onChange={e => results.setSearch(e.target.value)}
              containerClassName="w-full sm:w-48"
            />

              <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                {/* Only the categories this patient actually has. The hardcoded list this
                    replaces mirrored all five test_categories rows, so every patient was offered
                    2D Echo and ECG filters for services the clinic retired [1.47.0] — chips that
                    named a service nobody can book and returned nothing when clicked. */}
                {results.categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => results.setCategory(cat)}
                    className={`cursor-pointer rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                      results.category === cat
                        ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                        : 'bg-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
          </Toolbar>

          {/* Test Cards List */}
          <div className="space-y-3">
            {results.filtered.length > 0 ? (
              results.filtered.map(item => (
                <Card key={item.visit_test_id} className="border-[#e6ebf1] rounded-xl hover:shadow-raised transition-all">
                  <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start space-x-3.5">
                      <div className="w-10 h-10 bg-gray-50 border border-gray-200/80 rounded-xl flex items-center justify-center flex-shrink-0 text-brand-600">
                        {CATEGORY_ICONS[item.category_name] || <FlaskConical className="w-5 h-5" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-meta text-gray-400 font-bold uppercase tracking-wider">REQ-{item.visit_test_id}</span>
                          <StatusBadge status={item.test_status} className="text-meta px-2 py-0.5" />
                        </div>
                        <h3 className="font-bold text-slate-900 text-sm m-0">
                          {item.category_name} - {item.test_name}
                        </h3>
                        <div className="flex items-center space-x-3 text-xs text-gray-500">
                          <span className="flex items-center space-x-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{new Date(item.visit_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{new Date(item.visit_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Modal Trigger */}
                    {item.test_status === 'Completed' ? (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            className="border-brand-500 text-brand-600 hover:bg-brand-50 text-xs font-bold px-4 rounded-xl flex items-center space-x-1.5 cursor-pointer"
                          >
                            <CheckCircle className="w-4 h-4" />
                            <span>View Certificate Report</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">

                        {/* The patient's copy — the SAME component the clinic's copy uses. The
                            requirement is that staff record findings once and the saved result is
                            what gets printed; two renderings could only ever agree by coincidence,
                            and these two already did not. */}
                        <ResultReport
                          result={item}
                          patientName={`${profiles.selected?.first_name || ''} ${profiles.selected?.last_name || ''}`.trim()}
                          measurements={item.measurements || []}
                          signatories={item.signatories || []}
                          variant="patient"
                        >
                            {(item.file_path || item.file_url) && (
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                                <span className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-brand-600" />
                                  <span className="text-fine font-semibold text-slate-800">
                                    {item.file_original_name || 'Attached report'}
                                  </span>
                                </span>
                                {item.file_path ? (
                                  // View, not download. The patient is already looking at the
                                  // summary; making them save a file to read the report itself
                                  // is a step that exists only because nothing rendered it.
                                  <span className="flex items-center gap-1.5">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="xs"
                                      onClick={() => onPreviewDocument({
                                        visitTestId: item.visit_test_id,
                                        testName: item.test_name,
                                        patientName: `${profiles.selected?.first_name || ''} ${profiles.selected?.last_name || ''}`.trim(),
                                        fileName: item.file_original_name,
                                      })}
                                    >
                                      <Eye className="h-3 w-3" />
                                      View Report
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="xs"
                                      onClick={() => downloadResultFile(item.visit_test_id, item.file_original_name)}
                                    >
                                      <Download className="h-3 w-3" />
                                      Download
                                    </Button>
                                  </span>
                                ) : isSafeResultUrl(item.file_url) ? (
                                  <a
                                    href={item.file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-fine font-semibold text-brand-700 hover:underline"
                                  >
                                    <Download className="h-3 w-3" />
                                    Open attachment
                                  </a>
                                ) : (
                                  <span className="text-fine font-semibold text-amber-700">Attachment link unavailable</span>
                                )}
                              </div>
                            )}
                        </ResultReport>

                        <div className="flex justify-end pt-2">
                          <Button
                            onClick={printReport}
                            variant="outline"
                            className="text-xs font-bold flex items-center space-x-1.5"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print Official Copy</span>
                          </Button>
                        </div>

                        </DialogContent>
                      </Dialog>
                    ) : (
                      <Button 
                        variant="ghost" 
                        className="text-gray-500 hover:bg-gray-100 text-xs font-bold px-3 rounded-xl flex items-center space-x-1"
                      >
                        <span>Details</span>
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card className="border-dashed border-gray-200 bg-transparent text-center p-8 rounded-2xl">
                <Info className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-500">No diagnostic requests found matching the current filters.</p>
              </Card>
            )}
          </div>
        </TabsContent>
  );
}
