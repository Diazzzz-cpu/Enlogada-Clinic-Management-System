import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { SkeletonList } from '../ui/skeleton';
import api from '../../config/api';
import { formatDateTime } from '../../lib/date';
import { toastSuccess } from '../../lib/toast';
import { EMPTY_FEEDBACK, feedbackBody } from '../../lib/feedback';
import FeedbackForm from '../feedback/FeedbackForm';

/**
 * Typing in a walk-in's paper feedback form. [1.112.0]
 *
 * Most of the clinic's patients have no account and no email address, so the paper form is how
 * most feedback arrives; without this the overview would only describe the few who use the
 * portal. The same form the patient sees in the portal, in the language the paper was filled in
 * (Cebuano, as printed), with "no name on the paper" in place of the patient's own name switch.
 * Saved as a paper form with the receptionist's name on it.
 */
export default function PaperFeedbackDialog({ visit, onOpenChange, onRecorded }) {
  const open = Boolean(visit);
  const [questions, setQuestions] = useState(null);
  const [value, setValue] = useState(EMPTY_FEEDBACK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setValue(EMPTY_FEEDBACK);
    setError('');
    setQuestions(null);
    api.get('/feedback/questions')
      .then((res) => { if (!cancelled) setQuestions(res.data.data.questions || []); })
      .catch(() => { if (!cancelled) setError('The questions could not be loaded. Try again in a moment.'); });
    return () => { cancelled = true; };
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/feedback/visits/${visit.id}/paper`, feedbackBody(value));
      toastSuccess(`Paper form recorded for ${visit.first_name} ${visit.last_name}.`);
      onRecorded?.(visit.id);
      onOpenChange(false);
    } catch (err) {
      setError(err.response?.data?.message || 'The form could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Paper Feedback</DialogTitle>
          <DialogDescription>
            {visit ? `${visit.first_name} ${visit.last_name} · ${formatDateTime(visit.created_at)}. Tick what the patient ticked on the paper.` : ''}
          </DialogDescription>
        </DialogHeader>

        {error && <div role="alert" className="alert alert-error">{error}</div>}

        {questions === null && !error ? (
          <SkeletonList rows={3} />
        ) : questions ? (
          <FeedbackForm questions={questions} value={value} onChange={setValue} mode="paper" disabled={saving} />
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save} loading={saving} disabled={!questions}>Save Paper Form</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
