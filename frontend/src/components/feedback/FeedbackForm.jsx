import React from 'react';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import { LANGUAGES, RATINGS, word, promptFor } from '../../lib/feedback';

/**
 * The feedback form itself, for both ways it is filled in. [1.112.0]
 *
 * `mode="portal"` is the patient answering about their own visit; `mode="paper"` is reception
 * copying a paper form, where the name question becomes "was there a name on the paper?". One
 * component so the two cannot ask different things.
 *
 * Each question is a radio group of the paper form's three answers. Every question is optional,
 * and a chosen answer can be cleared by choosing it again — the paper form lets a patient leave a
 * row blank, and so does this.
 *
 * @param {object[]} questions  the questions being asked, in order
 * @param {{ language, answers, comment, nameHidden }} value
 * @param {(next) => void} onChange
 */
export default function FeedbackForm({ questions, value, onChange, mode = 'portal', disabled = false }) {
  const lang = value.language;
  const set = (patch) => onChange({ ...value, ...patch });
  const choose = (questionId, rating) => {
    const answers = { ...value.answers };
    if (answers[questionId] === rating) delete answers[questionId]; else answers[questionId] = rating;
    set({ answers });
  };

  return (
    <div className="space-y-4">
      {/* The form's language. The paper form is Cebuano, so that is where it starts. */}
      <div role="radiogroup" aria-label="Language" className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            disabled={disabled}
            onClick={() => set({ language: l.code })}
            className={cn(
              'cursor-pointer rounded-md border-0 px-3 py-1 text-fine font-semibold',
              lang === l.code ? 'bg-surface text-ink shadow-sm' : 'bg-transparent text-ink-muted'
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      {mode === 'portal' && <p className="m-0 text-fine text-ink-muted">{word('intro', lang)}</p>}

      <ol className="m-0 list-none space-y-3 p-0">
        {questions.map((q, i) => (
          <li key={q.id} data-testid="feedback-question" className="rounded-xl border border-line p-3">
            <p id={`fq-${q.id}`} className="m-0 mb-2 text-note font-semibold text-ink">
              {i + 1}. {promptFor(q, lang)}
            </p>
            <div role="radiogroup" aria-labelledby={`fq-${q.id}`} className="grid grid-cols-3 gap-2">
              {RATINGS.map((r) => {
                const picked = value.answers[q.id] === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    disabled={disabled}
                    onClick={() => choose(q.id, r.value)}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2 py-2 text-fine font-semibold transition-colors',
                      picked
                        ? r.tone === 'good'
                          ? 'border-brand-600 bg-brand-50 text-brand-800'
                          : r.tone === 'ok'
                            ? 'border-slate-500 bg-slate-100 text-slate-800'
                            : 'border-rose-500 bg-rose-50 text-rose-800'
                        : 'border-line bg-surface text-ink-muted hover:bg-sunken'
                    )}
                  >
                    {r.label[lang]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      <div className="space-y-1.5">
        <label htmlFor={`feedback-comment-${mode}`} className="field-label">{word('comment', lang)}</label>
        <Textarea
          id={`feedback-comment-${mode}`}
          rows={3}
          maxLength={1000}
          value={value.comment}
          disabled={disabled}
          onChange={(e) => set({ comment: e.target.value })}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-fine text-ink-muted">
        <input
          type="checkbox"
          checked={value.nameHidden}
          disabled={disabled}
          onChange={(e) => set({ nameHidden: e.target.checked })}
          className="mt-0.5 rounded text-brand-600 focus:ring-brand-500"
        />
        <span>{mode === 'paper' ? 'No name on the paper (PANGALAN left blank)' : word('hideName', lang)}</span>
      </label>
    </div>
  );
}
