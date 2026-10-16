import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, MessageSquareText, Pencil, Plus, Printer, RefreshCw } from 'lucide-react';
import PageHeader from '../../components/ui/page-header';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import Toolbar, { ToolbarField, ToolbarSpacer } from '../../components/ui/toolbar';
import { DateField, RANGE_PRESETS } from '../../components/ui/date-field';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import EmptyState from '../../components/ui/empty-state';
import Pagination from '../../components/ui/pagination';
import { SkeletonList } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import api from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { todayStr, daysAgoStr, formatDate } from '../../lib/date';
import { printReport } from '../../lib/reportPrint';
import { FeedbackPrint } from '../../components/reports/ReportPrints';
import { toastSuccess, toastError } from '../../lib/toast';
import { RATINGS, ratingLabel } from '../../lib/feedback';

const FORMS_PAGE_SIZE = 10;

/**
 * Patient Feedback: what patients said, and what they are asked. [1.112.0]
 *
 * The clinic's paper form, in the system. Patients answer in the portal once a visit's results
 * are released, reception types in the paper forms of walk-ins, and this is where both are read.
 *
 * Overview is a report (`reports:view`), bucketed by the VISIT date like every other clinical
 * figure, and prints on its own. Questions is `feedback:manage`: add, reorder, turn off. A
 * question that has been answered keeps its wording — last month's answers answered the question
 * as it was then — so changing what is asked means turning one off and adding another.
 */
export default function PatientFeedback() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('feedback:manage');

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessageSquareText}
        title="Patient Feedback"
        description="What patients said about their visit, from the portal and the paper forms — and which questions they are asked."
      />
      <Tabs defaultValue="overview" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {canManage && <TabsTrigger value="questions">Questions</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="m-0"><FeedbackOverview /></TabsContent>
        {canManage && <TabsContent value="questions" className="m-0"><FeedbackQuestions /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────

const TONE_FILL = { good: 'bg-brand-600', ok: 'bg-amber-400', poor: 'bg-rose-500' };

/** One question's answers as a bar, every segment also said in words beneath it. */
function QuestionBar({ q }) {
  if (!q.total) return <p className="m-0 text-fine text-slate-400">No answers yet in this range.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {RATINGS.map((r) => q[r.key] > 0 && (
          <span key={r.key} className={TONE_FILL[r.tone]} style={{ width: `${(q[r.key] / q.total) * 100}%` }} />
        ))}
      </div>
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-fine text-slate-600">
        {RATINGS.map((r) => (
          <span key={r.key}>
            <span className={`mr-1 inline-block h-2 w-2 rounded-full ${TONE_FILL[r.tone]}`} aria-hidden="true" />
            {r.label.ceb} <span className="font-semibold tabular-nums text-slate-900">{q[`${r.key}Pct`]}%</span>
            <span className="text-slate-400"> ({q[r.key]})</span>
          </span>
        ))}
      </p>
    </div>
  );
}

function FeedbackOverview() {
  // The printed form [1.117.0], in the same format as every report. It used to print the screen
  // through an element that was not a print area, and the print stylesheet hid all of it.
  const printRef = useRef(null);
  const [startDate, setStartDate] = useState(daysAgoStr(29));
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyPoor, setOnlyPoor] = useState(false);
  // Forms accumulate with every finished visit, up to 500 in a range, so the screen pages them
  // [1.128.0]. The printed report still lists every form in the period.
  const [formsPage, setFormsPage] = useState(1);
  useEffect(() => { setFormsPage(1); }, [onlyPoor, report]);
  // The range the figures are FOR, for the printed period.
  const [period, setPeriod] = useState({ startDate, endDate });

  const load = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/feedback/overview', { params: { startDate: from, endDate: to } });
      setReport(res.data.data.report);
      setPeriod({ startDate: from, endDate: to });
    } catch (err) {
      setError(err.response?.data?.message || 'The feedback overview could not be loaded.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(startDate, endDate); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = report?.questions || [];
  const number = new Map(questions.map((q, i) => [String(q.id), i + 1]));
  const forms = (report?.forms || []).filter((f) => !onlyPoor || Object.values(f.answers || {}).includes(1));
  const poorForms = (report?.forms || []).filter((f) => Object.values(f.answers || {}).includes(1)).length;
  const formPages = Math.max(1, Math.ceil(forms.length / FORMS_PAGE_SIZE));
  const shownForms = forms.slice((Math.min(formsPage, formPages) - 1) * FORMS_PAGE_SIZE, Math.min(formsPage, formPages) * FORMS_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Toolbar>
        <ToolbarField label="From" htmlFor="fb-from">
          <DateField id="fb-from" presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-[9.5rem]" />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="fb-to">
          <DateField id="fb-to" presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-[9.5rem]" />
        </ToolbarField>
        <Button variant="outline" onClick={() => load(startDate, endDate)} loading={loading}>
          <RefreshCw className="h-3.5 w-3.5" />
          Apply
        </Button>
        <ToolbarSpacer />
        <Button variant="outline" disabled={!report || loading} onClick={() => printReport(printRef.current)}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </Toolbar>

      {error ? (
        <EmptyState tone="error" title="Couldn't load the feedback overview" description={error}
          action={<Button variant="outline" size="sm" onClick={() => load(startDate, endDate)}>Try again</Button>} />
      ) : loading && !report ? (
        <SkeletonList rows={4} />
      ) : report && (
        <div className="space-y-4" data-testid="feedback-overview">

          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="Forms received" value={report.responses}
              hint={report.responseRate === null ? 'No finished visits in this range' : `${report.responseRate}% of ${report.completedVisits} finished visits`} />
            <Figure label="How they arrived" value={`${report.byChannel.portal} · ${report.byChannel.paper}`} hint="Portal · paper forms typed in" />
            <Figure label="Forms with a Dili maayo" value={poorForms} hint="Worth following up" tone={poorForms ? 'warn' : 'default'} />
          </div>

          <Panel>
            <PanelHeader title="By question" description="Every answer to each question, in this range." />
            <PanelBody className="space-y-4">
              {questions.length === 0 ? (
                <p className="m-0 text-fine text-slate-500">No questions are being asked.</p>
              ) : questions.map((q, i) => (
                <div key={q.id} data-testid="feedback-question-summary" className="space-y-1.5">
                  <p className="m-0 text-note font-semibold text-slate-900">
                    {i + 1}. {q.prompt_ceb}
                    {!q.is_active && <Badge variant="outline" className="ml-2 align-middle">Turned off</Badge>}
                  </p>
                  <p className="m-0 text-fine text-slate-500">{q.prompt_en}</p>
                  <QuestionBar q={q} />
                </div>
              ))}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Forms"
              description="Newest visit first. A name is shown only when the patient gave it."
              actions={(
                <label className="no-print flex cursor-pointer items-center gap-1.5 text-fine font-medium text-slate-600">
                  <input type="checkbox" checked={onlyPoor} onChange={(e) => setOnlyPoor(e.target.checked)}
                    className="rounded text-brand-600 focus:ring-brand-500" />
                  Only forms with a Dili maayo
                </label>
              )}
            />
            <PanelBody flush>
              {forms.length === 0 ? (
                <EmptyState compact icon={MessageSquareText}
                  title={onlyPoor ? 'No Dili maayo in this range' : 'No forms in this range'}
                  description="A form appears here when a patient answers in the portal, or reception types in a paper one." />
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {shownForms.map((f) => (
                    <li key={f.visit_id} data-testid="feedback-form" className="space-y-1.5 px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-note font-semibold text-slate-900">
                          {f.patient_name || <span className="font-normal italic text-slate-500">Name not given</span>}
                        </span>
                        <span className="flex items-center gap-2 text-fine text-slate-500">
                          Visit {formatDate(f.visit_date)}
                          <Badge variant="outline">
                            {f.feedback_channel === 'paper' ? `Paper${f.recorded_by_name ? ` · typed by ${f.recorded_by_name}` : ''}` : 'Portal'}
                          </Badge>
                        </span>
                      </div>
                      <p className="m-0 flex flex-wrap gap-1.5">
                        {Object.entries(f.answers || {})
                          .sort(([a], [b]) => (number.get(a) || 99) - (number.get(b) || 99))
                          .map(([qid, rating]) => (
                            <span key={qid} className={`rounded-md px-1.5 py-0.5 text-micro font-semibold ${
                              rating === 3 ? 'bg-brand-50 text-brand-800' : rating === 2 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'}`}>
                              {number.get(qid) ? `Q${number.get(qid)}` : 'Q'} {ratingLabel(rating, 'ceb')}
                            </span>
                          ))}
                      </p>
                      {f.feedback_comment && (
                        <p className="m-0 border-l-2 border-line pl-3 text-fine italic text-slate-700">“{f.feedback_comment}”</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
            {forms.length > 0 && (
              <Pagination
                page={Math.min(formsPage, formPages)}
                totalPages={formPages}
                onPageChange={setFormsPage}
                total={forms.length}
                pageSize={FORMS_PAGE_SIZE}
              />
            )}
          </Panel>
        </div>
      )}

      {report && (
        <FeedbackPrint
          ref={printRef}
          report={report}
          forms={forms}
          ratings={RATINGS}
          ratingLabel={ratingLabel}
          startDate={period.startDate}
          endDate={period.endDate}
        />
      )}
    </div>
  );
}

function Figure({ label, value, hint, tone = 'default' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="m-0 text-micro font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`m-0 text-stat font-bold tabular-nums ${tone === 'warn' ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p>
      <p className="m-0 text-fine text-slate-500">{hint}</p>
    </div>
  );
}

// ── Questions ────────────────────────────────────────────────────────────────────────────────

const EMPTY_DRAFT = { promptCeb: '', promptTl: '', promptEn: '' };

function FeedbackQuestions() {
  const [questions, setQuestions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);   // { id?, promptCeb, promptTl, promptEn }

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get('/feedback/questions/manage');
      setQuestions(res.data.data.questions || []);
    } catch (err) {
      setError(err.response?.data?.message || 'The questions could not be loaded.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const move = async (index, delta) => {
    const ids = questions.map((q) => q.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(`move-${questions[index].id}`);
    try {
      const res = await api.put('/feedback/questions/order', { ids });
      setQuestions(res.data.data.questions);
    } catch (err) {
      toastError(err.response?.data?.message || 'The order could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (q) => {
    setBusy(`toggle-${q.id}`);
    try {
      await api.put(`/feedback/questions/${q.id}`, { isActive: !q.is_active });
      toastSuccess(q.is_active ? 'Question turned off. Patients are no longer asked it.' : 'Question turned on. Patients are asked it again.');
      await load();
    } catch (err) {
      toastError(err.response?.data?.message || 'That could not be changed.');
    } finally {
      setBusy(null);
    }
  };

  const asked = (questions || []).filter((q) => q.is_active).length;

  return (
    <div className="space-y-4">
      {error ? (
        <EmptyState tone="error" title="Couldn't load the questions" description={error}
          action={<Button variant="outline" size="sm" onClick={load}>Try again</Button>} />
      ) : questions === null ? (
        <SkeletonList rows={4} />
      ) : (
        <Panel>
          <PanelHeader
            title="Questions"
            description={asked === 0
              ? 'Every question is turned off, so patients are not asked for feedback at all.'
              : `${asked} asked, in this order. The three answers are always Maayo, Okay lang and Dili maayo.`}
            actions={<Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}><Plus className="h-3.5 w-3.5" />Add question</Button>}
          />
          <PanelBody flush>
            <ol className="m-0 list-none divide-y divide-line p-0">
              {questions.map((q, i) => (
                <li key={q.id} data-testid="feedback-question-row" data-question-id={q.id}
                  className={`flex flex-wrap items-start gap-3 px-5 py-3 ${q.is_active ? '' : 'bg-slate-50/70'}`}>
                  <div className="flex flex-col gap-1 pt-0.5">
                    <Button type="button" variant="ghost" size="xs" aria-label={`Move question ${i + 1} up`}
                      disabled={i === 0 || Boolean(busy)} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                    <Button type="button" variant="ghost" size="xs" aria-label={`Move question ${i + 1} down`}
                      disabled={i === questions.length - 1 || Boolean(busy)} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="m-0 text-note font-semibold text-slate-900">
                      {q.prompt_ceb}
                      <Badge variant="outline" className="ml-2 align-middle">{q.is_active ? 'Asked' : 'Turned off'}</Badge>
                    </p>
                    <p className="m-0 text-fine text-slate-500">{q.prompt_tl}</p>
                    <p className="m-0 text-fine text-slate-500">{q.prompt_en}</p>
                    <p className="m-0 text-micro text-slate-400">
                      {q.answer_count > 0 ? `${q.answer_count} answer${q.answer_count === 1 ? '' : 's'} — wording kept` : 'Not answered yet — wording can still be changed'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="xs"
                      disabled={q.answer_count > 0}
                      title={q.answer_count > 0 ? 'Answered questions keep their wording. Turn it off and add a new one instead.' : undefined}
                      onClick={() => setEditing({ id: q.id, promptCeb: q.prompt_ceb, promptTl: q.prompt_tl, promptEn: q.prompt_en })}>
                      <Pencil className="h-3 w-3" />Edit
                    </Button>
                    <Button type="button" variant="outline" size="xs" loading={busy === `toggle-${q.id}`} onClick={() => toggle(q)}>
                      {q.is_active ? 'Turn off' : 'Turn on'}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
      )}

      <QuestionDialog draft={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
    </div>
  );
}

/** Adding a question, or rewording one nobody has answered yet. All three languages required. */
function QuestionDialog({ draft, onClose, onSaved }) {
  const [value, setValue] = useState(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) { setValue({ promptCeb: draft.promptCeb, promptTl: draft.promptTl, promptEn: draft.promptEn }); setError(''); }
  }, [draft]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (draft.id) await api.put(`/feedback/questions/${draft.id}`, value);
      else await api.post('/feedback/questions', value);
      toastSuccess(draft.id ? 'Question updated.' : 'Question added. Patients are asked it from now on.');
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'The question could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, id) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className="field-label">{label}</label>
      <Textarea id={id} rows={2} maxLength={300} value={value[key]}
        onChange={(e) => setValue((v) => ({ ...v, [key]: e.target.value }))} disabled={saving} />
    </div>
  );

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft?.id ? 'Edit Question' : 'Add Question'}</DialogTitle>
          <DialogDescription>
            Write it in all three languages; the patient chooses which to read. It is answered Maayo, Okay lang or Dili maayo.
          </DialogDescription>
        </DialogHeader>
        {error && <div role="alert" className="alert alert-error">{error}</div>}
        <div className="space-y-3">
          {field('promptCeb', 'Cebuano', 'fq-ceb')}
          {field('promptTl', 'Tagalog', 'fq-tl')}
          {field('promptEn', 'English', 'fq-en')}
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={save} loading={saving}>{draft?.id ? 'Save Changes' : 'Add Question'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
