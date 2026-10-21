import React from 'react';
import { AlertCircle, CheckCircle2, FileText, Mail, MailCheck, Paperclip, Send } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { REPORT_FILE_ACCEPT, REPORT_FILE_HINT } from '../../lib/reportFileTypes';

/**
 * Recording findings, and authorising the release that sends them to the patient.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 * 
 * The release confirmation travels with it: authorising is irreversible from this screen, so the
 * question and the form asking it belong together. Releasing does NOT email the patient [1.113.0]:
 * the panel after it offers the email, for a patient who wants it sent.
 *
 * ── The report is a document, not typing ────────────────────────────────────────────────────
 *
 * [1.94.0] This form used to ask for findings, remarks and a grid of structured measurements, and
 * offered canned templates to start from. The clinic already produces a report file for every
 * diagnosis, so all of that asked them to transcribe a document they were holding — which is why
 * only 4 results in the whole database ever carried a structured measurement.
 *
 * What a result IS is now the attached document. The file is required to RELEASE but not to save,
 * because parking a ticket in 'Waiting for Release' while the report is being produced is what
 * that state has always been for.
 */
export default function ResultEntryDialog({ entry, patientHistory }) {
  return (
    <>
      <Dialog
        open={entry.open}
        onOpenChange={(next) => { if (!next) entry.close(); }}
      >
        <DialogContent className="max-w-2xl">
          {entry.justReleased ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-bold">Result released successfully.</span>
              </div>

              {/* No generated certificate. [1.94.0] This used to render the clinic's own copy of
                  the report from typed findings and measurements; the released document is now the
                  file the clinic attached, so a second rendering of it here would be a letterhead
                  wrapped around an empty box. The report is read and printed from the result, where
                  the patient reads it too. */}
              <div className="rounded-xl border border-line bg-slate-50/70 p-3">
                <p className="m-0 text-fine text-slate-600">
                  <span className="font-semibold text-slate-700">{entry.justReleased.file_original_name || 'The attached report'}</span>{' '}
                  {entry.justReleased.has_portal_account
                    ? <> is on this patient&apos;s record and in their portal, where it can be read. It has not been emailed.</>
                    : <> is on this patient&apos;s record. It has not been emailed. They have no portal account{entry.justReleased.patient_email ? ': email it below, or' : ', so'} the desk can invite them to the portal from Patient Records.</>}
                </p>
              </div>

              {/* Emailing is the patient's choice, so it is offered, never done for them. [1.113.0]
                  History's Email button sends it later just the same. */}
              <div data-testid="release-email" className="rounded-xl border border-line p-3">
                {entry.emailState.status === 'sent' ? (
                  <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-brand-700">
                    <MailCheck className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {entry.emailState.message}
                  </p>
                ) : entry.justReleased.patient_email ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 text-fine text-slate-600">
                      Does the patient want it by email? It would go to <strong>{entry.justReleased.patient_email}</strong>.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={entry.emailReleased}
                      loading={entry.emailState.status === 'sending'}>
                      <Mail className="h-3.5 w-3.5" />
                      Email to patient
                    </Button>
                  </div>
                ) : (
                  <p className="m-0 text-fine text-slate-500">
                    No email address on file. If the patient wants it emailed, add one in Patient
                    Records, then send it from History.
                  </p>
                )}
                {entry.emailState.status === 'failed' && (
                  <p role="alert" className="m-0 mt-2 text-fine text-rose-700">{entry.emailState.message}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={entry.close}
                  className="text-xs font-bold"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              {entry.isEditing ? 'Correct Released Result' : 'Attach Report & Release Result'}
            </DialogTitle>
            <DialogDescription>
              Patient: <strong>{entry.activeTest?.first_name} {entry.activeTest?.last_name}</strong> &bull; Examination: <strong>{entry.activeTest?.test_name}</strong>
              {entry.isEditing && " — the corrected report replaces the old one in the patient's portal."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={entry.record} className="space-y-4 pt-2">
            {entry.error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{entry.error}</span>
              </div>
            )}

            {/* Phase C finding 02: past results for this same patient, surfaced at the point
                of writing new findings — GET /results/history/:patientId already existed but
                nothing on this screen ever called it. */}
            {(patientHistory.loading || patientHistory.results.length > 0) && (
              <div className="space-y-1.5">
                <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Past Results for This Patient</span>
                {patientHistory.loading ? (
                  <p className="text-fine text-gray-400 m-0">Loading history…</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl divide-y divide-[#eef2f6] max-h-32 overflow-y-auto">
                    {patientHistory.results.map(h => (
                      <div key={h.visit_test_id} className="px-3 py-2 flex items-center justify-between gap-2 text-fine">
                        <span className="font-semibold text-gray-700 truncate">{h.category_name} &middot; {h.test_name}</span>
                        <span className="text-gray-400 whitespace-nowrap">{new Date(h.visit_date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* The report itself. Mandatory to RELEASE, not to save — see the note at the top.
                The hint names which of the three states this ticket is in, because "no file" and
                "a file is already on the server" look identical in an empty file input, and that
                ambiguity is what would otherwise make a technician re-upload a report that was
                already attached. activeTest.file_path comes from the worklist query. */}
            <div className="space-y-1.5">
              <label htmlFor="diagnosticdashboard-attach-report-file" className="field-label">
                Attach Report File <span className="text-rose-600">*</span>
              </label>
              <input id="diagnosticdashboard-attach-report-file"
                type="file"
                accept={REPORT_FILE_ACCEPT}
                onChange={entry.chooseFile}
                className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 file:cursor-pointer cursor-pointer"
              />
              {entry.resultFile ? (
                <>
                  <p className="text-fine font-semibold text-slate-700 m-0 flex items-center gap-1.5">
                    <Paperclip className="w-3 h-3 flex-shrink-0" />
                    {entry.resultFile.name} ({(entry.resultFile.size / 1024).toFixed(0)} KB)
                  </p>
                  {/* [1.123.0] Patients receive a marked DIGITAL COPY, and a Word or Excel file
                      cannot be marked: the portal tells the patient to visit the clinic and Email
                      to patient refuses it. Said here, while a PDF can still be attached instead. */}
                  {!/\.(pdf|jpe?g|png)$/i.test(entry.resultFile.name) && (
                    <p role="note" data-testid="office-report-warning" className="m-0 rounded-lg border border-amber-200 bg-amber-50 p-2 text-fine text-amber-800">
                      Patients can&apos;t open a Word or Excel report in their portal, and it can&apos;t be
                      emailed to them. Attach a PDF if you can.
                    </p>
                  )}
                </>
              ) : entry.activeTest?.file_path ? (
                <p className="text-fine text-slate-600 m-0 flex items-center gap-1.5">
                  <Paperclip className="w-3 h-3 flex-shrink-0" />
                  {entry.activeTest.file_original_name || 'A report'} is already attached — choose a
                  file only to replace it.
                </p>
              ) : (
                <p className="text-fine text-gray-400 m-0">
                  {REPORT_FILE_HINT} — up to 15MB. Required before this result can be released.
                </p>
              )}
            </div>

            {/* Why a released report is being changed. Required on an amendment because the
                audit entry is otherwise "something changed" and nothing more — the superseded
                version is kept, but without a reason nobody can tell why it was replaced. */}
            {entry.isAmendingReleased && (
              <div className="space-y-1.5">
                <label htmlFor="amendment-reason" className="field-label">
                  Reason for Amendment <span className="text-rose-600">*</span>
                </label>
                <Input
                  id="amendment-reason"
                  placeholder="e.g. Transcription error in the original report"
                  value={entry.amendmentReason}
                  onChange={e => entry.setAmendmentReason(e.target.value)}
                  className="text-xs rounded-xl"
                />
                <p className="text-fine text-gray-400 m-0">
                  The previous version is kept and stays readable in this test&apos;s history — it is
                  superseded, not overwritten. The patient is told their report was updated.
                </p>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-line">
              <Button type="button" variant="outline" onClick={entry.close}>Cancel</Button>
              <Button
                type="submit"
                disabled={entry.saving || (entry.isAmendingReleased && entry.amendmentReason.trim().length < 4)}
                variant="outline"
                className="font-bold text-xs px-5 py-2 rounded-xl border-gray-200 flex items-center space-x-1.5"
              >
                <FileText className="w-4 h-4" />
                <span>{entry.saving ? 'Saving…' : 'Save for Later'}</span>
              </Button>
              <Button
                type="button"
                onClick={entry.requestRelease}
                disabled={!entry.hasReport()}
                title={entry.hasReport() ? undefined : 'Attach the report file first'}
                className="font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5"
              >
                <Send className="w-4 h-4" />
                <span>{entry.isEditing ? 'Save Correction & Re-release' : 'Authorize & Release Result'}</span>
              </Button>
            </div>
          </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Result release confirmation — irreversible/clinically significant, see .agents Phase 12 */}
      <ConfirmDialog
        open={entry.confirmingRelease}
        onOpenChange={(next) => { if (!next) entry.dismissReleaseConfirm(); }}
        title={entry.isEditing ? 'Save Correction' : 'Authorize & Release Result'}
        description={entry.activeTest ? (
          entry.isEditing
            ? `Save the corrected ${entry.activeTest.test_name} report for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? It replaces the old one in their portal. It is not emailed unless you send it.`
            : `Release ${entry.activeTest.test_name} findings for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? This finalizes the result and cannot be undone from this screen.`
        ) : ''}
        confirmLabel={entry.isEditing ? 'Save Correction' : 'Authorize & Release'}
        onConfirm={entry.release}
        loading={entry.releasing}
        error={entry.error}
      />
    </>
  );
}
