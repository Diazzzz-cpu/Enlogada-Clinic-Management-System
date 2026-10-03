import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Paperclip, PhoneCall } from 'lucide-react';
import EmptyState from '../ui/empty-state';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { formatDateTime } from '../../lib/date';

/**
 * Who still has to be telephoned about a panic value, and recording that they were.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 *
 * Who still has to be telephoned. [1.28.0]
 * The endpoint existed with nothing reading it; before that, the only sign of a panic
 * value anywhere was a badge on one department's worklist row. Oldest first, because the
 * age of an un-made call is the whole severity of it — and the number is shown in the
 * open rather than behind a hover, since the reason this fails is people not looking.
 *
 * And recording it. [1.74.0] This dialog said "record the call" with no way to, so the list only
 * ever grew. Each row now takes a short note (who was reached) and a Record button. The note is an
 * <input>, not a <textarea>: laboratory.spec.js drives the result entry dialog with a bare
 * `page.locator('textarea')`, and this dialog can be open on the same screen.
 */
export default function CriticalCallbackDialog({ criticals }) {
  // Keyed by visit test, so a note being typed survives the 30-second poll re-rendering the list.
  const [notes, setNotes] = useState({});

  const submit = async (event, item) => {
    event.preventDefault();
    const done = await criticals.record(item, notes[item.visit_test_id] || '');
    if (done) {
      setNotes((prev) => {
        const next = { ...prev };
        delete next[item.visit_test_id];
        return next;
      });
    }
  };

  const failedEmpty = Boolean(criticals.error) && criticals.outstanding.length === 0;

  return (
    <Dialog open={criticals.expanded} onOpenChange={criticals.setExpanded}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Critical results awaiting a callback</DialogTitle>
          <DialogDescription>
            Released with a panic value and not yet confirmed as communicated. Telephone the
            patient, then record the call — whoever makes it, from any department.
          </DialogDescription>
        </DialogHeader>

        {/* A failed refresh over a list that did load: the rows are still true, only older. */}
        {criticals.error && !failedEmpty && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>Couldn't refresh this list. It may be out of date.</span>
            <button
              type="button"
              onClick={criticals.reload}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-rose-800 underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {criticals.outstanding.map((c) => {
            const noteId = `callback-note-${c.visit_test_id}`;
            return (
              <div
                key={c.visit_test_id}
                data-testid="critical-callback"
                data-visit-test-id={c.visit_test_id}
                className="rounded-xl border border-rose-200 bg-rose-50/60 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-note font-bold text-slate-900">
                      {c.first_name} {c.last_name}
                    </p>
                    <p className="m-0 text-fine text-slate-600">
                      {c.test_name} &bull; released {c.released_at ? formatDateTime(c.released_at) : '—'}
                    </p>
                  </div>
                  {/* The number is the point of the row: it is what the person acts on. */}
                  {c.contact_number && (
                    <a
                      href={`tel:${c.contact_number}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-fine font-bold text-destructive-foreground no-underline hover:bg-destructive-hover"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      {c.contact_number}
                    </a>
                  )}
                </div>
                {/* What the call is ABOUT. [1.94.0] This was the findings snippet and nothing
                    else, so once a report became an attached document rather than typed text the
                    person picking up the phone would have seen a blank card — a panic result with
                    no indication of what the panic value was.

                    The file is named but deliberately not openable from here. This queue is not
                    department-scoped, because the front desk makes the call, while the file route
                    IS scoped through assertStaffAllowedCategory — and a Receptionist belongs to no
                    department, so an open button here would 403 for the one role it exists for.
                    The report is opened from the patient's record. */}
                {c.findings ? (
                  <p className="m-0 mt-1.5 line-clamp-2 text-fine text-slate-700">{c.findings}</p>
                ) : c.has_file ? (
                  <p className="m-0 mt-1.5 flex items-center gap-1.5 text-fine text-slate-700">
                    <Paperclip className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{c.file_original_name || 'Report attached'}</span>
                    <span className="text-slate-500">— open it on the patient&apos;s record</span>
                  </p>
                ) : (
                  <p className="m-0 mt-1.5 text-fine font-semibold text-rose-700">
                    No report on this result — check the record before calling.
                  </p>
                )}
                {!c.contact_number && (
                  <p className="m-0 mt-1.5 text-fine font-semibold text-rose-700">
                    No contact number on file — check the visit record.
                  </p>
                )}

                <form onSubmit={(e) => submit(e, c)} className="mt-2.5 flex flex-wrap items-center gap-2">
                  <label htmlFor={noteId} className="sr-only">
                    Who you spoke to about {c.first_name} {c.last_name}'s result
                  </label>
                  <Input
                    id={noteId}
                    value={notes[c.visit_test_id] || ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [c.visit_test_id]: e.target.value }))}
                    placeholder="Who you spoke to, e.g. the patient, 2:20 PM"
                    maxLength={500}
                    disabled={criticals.recordingId === c.visit_test_id}
                    className="min-w-0 flex-1 basis-56"
                  />
                  <Button type="submit" size="sm" loading={criticals.recordingId === c.visit_test_id}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Record the call
                  </Button>
                </form>
              </div>
            );
          })}
          {failedEmpty && (
            <EmptyState
              tone="error"
              icon={AlertCircle}
              title="Couldn't check for critical results"
              description={criticals.error}
              action={
                <Button variant="outline" size="sm" onClick={criticals.reload}>
                  Try again
                </Button>
              }
            />
          )}
          {!criticals.error && criticals.outstanding.length === 0 && (
            <EmptyState
              icon={CheckCircle2}
              title="Every critical result has been called through"
              description="Nothing is waiting on a phone call."
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
