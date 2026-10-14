import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { SkeletonList } from '../ui/skeleton';
import api from '../../config/api';
import { formatAppointmentDate } from '../../lib/date';
import { word, EMPTY_FEEDBACK, feedbackBody } from '../../lib/feedback';
import { toastSuccess } from '../../lib/toast';
import FeedbackForm from '../feedback/FeedbackForm';

/**
 * The patient's feedback form for one finished visit. [1.112.0]
 *
 * Opened from "Needs your attention" on Home. "Not now" closes it and leaves the visit asking;
 * sending it removes the visit from the list. The questions are read when it opens, so one Admin
 * turned off a minute ago is not asked.
 */
export default function FeedbackDialog({ visit, onOpenChange, onSent }) {
  const open = Boolean(visit);
  const [questions, setQuestions] = useState(null);
  const [value, setValue] = useState(EMPTY_FEEDBACK);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setValue(EMPTY_FEEDBACK);
    setError('');
    setQuestions(null);
    api.get('/feedback/questions')
      .then((res) => { if (!cancelled) setQuestions(res.data.data.questions || []); })
      .catch(() => { if (!cancelled) setError('The questions could not be loaded. Please try again later.'); });
    return () => { cancelled = true; };
  }, [open]);

  const send = async () => {
    setSending(true);
    setError('');
    try {
      await api.post(`/feedback/visits/${visit.visit_id}`, feedbackBody(value));
      toastSuccess(word('thanks', value.language));
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Your feedback could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{word('title', value.language)}</DialogTitle>
          <DialogDescription>
            {visit ? `${visit.first_name} ${visit.last_name} · ${formatAppointmentDate(visit.visit_date)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {error && <div role="alert" className="alert alert-error">{error}</div>}

        {questions === null && !error ? (
          <SkeletonList rows={3} />
        ) : questions ? (
          <FeedbackForm questions={questions} value={value} onChange={setValue} disabled={sending} />
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {word('later', value.language)}
          </Button>
          <Button type="button" onClick={send} loading={sending} disabled={!questions}>
            {word('submit', value.language)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
