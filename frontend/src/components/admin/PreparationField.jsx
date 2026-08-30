import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Input } from '../ui/input';
import {
  PREPARATION_RULES,
  composePreparation,
  parsePreparation,
} from '../../lib/preparation';

/**
 * What the patient must do before this test. [1.54.0]
 *
 * A free-text box produced four sentences across sixteen services, two of them the same
 * instruction in different words — see lib/preparation.js for the measurement. Ticking a
 * requirement composes the wording, so two tests that need the same thing say the same thing.
 *
 * ── The preview is the point ────────────────────────────────────────────────────────────────
 *
 * Whoever edits this is choosing requirements; the PATIENT reads a sentence. Showing the composed
 * text live keeps those two things joined — without it the editor is ticking boxes and hoping,
 * and the first time anyone sees the result is in a patient's inbox the night before.
 *
 * Free text stays, and stays last. Some preparation is genuinely specific ("stop your metformin
 * for 48 hours"), and a form that cannot express it would push people back into writing the whole
 * thing by hand, which is what this replaces.
 */
export default function PreparationField({ value, onChange, id = 'preparation' }) {
  // Parsed once per opened dialog, not on every keystroke: re-parsing our own composed output
  // would fight the editor — ticking a box changes `value`, which would re-derive the toggles.
  const initial = useMemo(() => parsePreparation(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState(initial.selected);
  const [freeText, setFreeText] = useState(initial.freeText);

  const composed = composePreparation(selected, freeText);

  useEffect(() => {
    onChange(composed);
    // `onChange` is a fresh closure on every render of the parent form, so depending on it would
    // loop. The composed string is the only thing that should drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed]);

  const toggle = (rule) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[rule.id]) delete next[rule.id];
      else next[rule.id] = rule.field ? { [rule.field.key]: rule.field.default } : true;
      return next;
    });
  };

  const setRuleField = (rule, raw) => {
    setSelected((prev) => ({ ...prev, [rule.id]: { ...prev[rule.id], [rule.field.key]: raw } }));
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold text-gray-700">
        Patient Preparation
        <span className="ml-1 font-normal text-slate-400">(tick what applies)</span>
      </span>

      <div className="space-y-1 rounded-xl border border-line bg-slate-50/70 p-2">
        {PREPARATION_RULES.map((rule) => {
          const on = Boolean(selected[rule.id]);
          return (
            <div key={rule.id} className="rounded-lg bg-surface px-2 py-1.5 ring-1 ring-inset ring-line">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(rule)}
                  className="mt-0.5 rounded text-brand-600 focus:ring-brand-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-fine font-semibold text-slate-800">{rule.label}</span>
                  {/* Which tests this belongs on. Whoever prices a service is not always the
                      person who knows that a pelvic scan needs a full bladder. */}
                  <span className="block text-micro leading-snug text-slate-500">{rule.hint}</span>
                </span>
              </label>

              {on && rule.field && (
                <div className="mt-1.5 flex items-center gap-2 pl-7">
                  <label htmlFor={`${id}-${rule.id}`} className="text-micro font-semibold text-slate-600">
                    {rule.field.label}
                  </label>
                  <Input
                    id={`${id}-${rule.id}`}
                    type="number"
                    min={rule.field.min}
                    max={rule.field.max}
                    value={selected[rule.id]?.[rule.field.key] ?? rule.field.default}
                    onChange={(e) => setRuleField(rule, e.target.value)}
                    className="h-7 w-20 text-fine"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-other`} className="text-micro font-semibold text-slate-600">
          Anything else <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id={`${id}-other`}
          rows={2}
          placeholder="e.g. Stop your metformin for 48 hours before the scan."
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-note leading-relaxed text-slate-800 placeholder:text-slate-400 focus-visible:border-brand-500"
        />
      </div>

      {/* What the patient will actually read, shown while it is being decided. */}
      <div className="rounded-lg border border-azure-200 bg-azure-50/50 px-2.5 py-2">
        <p className="m-0 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-azure-800">
          <Info className="h-3 w-3" aria-hidden="true" />
          The patient will be told
        </p>
        <p data-testid="preparation-preview" className="m-0 mt-1 text-fine leading-relaxed text-slate-700">
          {composed || <span className="italic text-slate-400">Nothing — no preparation needed for this test.</span>}
        </p>
      </div>
    </div>
  );
}
