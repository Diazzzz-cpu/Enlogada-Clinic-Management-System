import React from 'react';

import { Input } from '../ui/input';
import { DateField } from '../ui/date-field';

/**
 * The measurement half of a result. [1.50.0]
 *
 * Rendered only when the API returns a field set for this test, which is a data-driven switch
 * rather than a check on the category: Laboratory and X-ray tests have no field set, get `null`,
 * and their dialog stays byte-identical to what it was before this feature existed. Turning a
 * modality on later is seed data, not a code change.
 *
 * ── Never a second <textarea> on this screen ─────────────────────────────────────────────────
 *
 * `laboratory.spec.js` drives the findings box with a BARE `page.locator('textarea')`. Playwright's
 * strict mode fails on multiple matches, so a second textarea anywhere in this dialog breaks two
 * browser tests with a strict-mode violation rather than a useful message — and it would break
 * them from a file that never mentions this component. Every input here is an `<input>`.
 *
 * ── Why the derived values are not computed in the browser ───────────────────────────────────
 *
 * A prostate weight could be shown live as the axes are typed, and that would be nicer. It would
 * also put a second copy of clinical arithmetic in the frontend, and this codebase has been bitten
 * by exactly that often enough to have a rule about it — `moneyRange.js` exists because two copies
 * of a money rule drifted apart within one commit. The server computes on save and the stored
 * figure appears on the next read, which is the same trade the receipt makes with its totals.
 */

/** A field whose value the system produces. Shown, never typed into unless deliberately taken over. */
const isDerived = (field) => !!field.derivation;

function LinearTriple({ field, value, disabled, onChange }) {
  const set = (axis) => (e) => onChange({ ...value, [axis]: e.target.value });
  return (
    <div className="flex items-center gap-1.5">
      {['value_1', 'value_2', 'value_3'].map((axis, i) => (
        <React.Fragment key={axis}>
          {i > 0 && <span className="text-fine text-slate-400">&times;</span>}
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            aria-label={`${field.label} ${['length', 'width', 'height'][i]}`}
            data-testid={`measurement-${field.code}-${i + 1}`}
            className="w-20 text-right tabular-nums"
            value={value?.[axis] ?? ''}
            disabled={disabled}
            onChange={set(axis)}
          />
        </React.Fragment>
      ))}
      {field.unit && <span className="text-fine text-slate-500">{field.unit}</span>}
    </div>
  );
}

export default function MeasurementGrid({ fieldSet, values, patientSex, onChange, disabled = false }) {
  if (!fieldSet) return null;

  // A field belonging to the other sex is not shown at all. The clinic's own reports carry a
  // prostate or a uterus and never both — of 405 whole abdomens, not one had two — so showing
  // both would invite exactly the entry the server refuses.
  const fields = fieldSet.fields.filter(
    (f) => !f.applies_to_sex || !patientSex || f.applies_to_sex === patientSex
  );
  if (!fields.length) return null;

  const setField = (code, next) => onChange({ ...values, [code]: next });

  return (
    <div className="space-y-2 rounded-xl border border-line bg-slate-50/60 p-3">
      <div className="flex items-baseline justify-between">
        <span className="field-label m-0">Measurements</span>
        <span className="text-meta text-slate-400">{fieldSet.name}</span>
      </div>

      <div className="space-y-1.5">
        {fields.map((field) => {
          const value = values?.[field.code] || {};
          const derived = isDerived(field);

          return (
            <div
              key={field.code}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
              data-testid={`measurement-row-${field.code}`}
            >
              <label className="text-fine text-slate-600" htmlFor={`measurement-${field.code}`}>
                {field.label}
                {field.reference_note && (
                  <span className="ml-1.5 text-meta text-slate-400">{field.reference_note}</span>
                )}
                {derived && (
                  <span className="ml-1.5 text-meta text-slate-400">computed on save</span>
                )}
              </label>

              {field.value_kind === 'linear3' ? (
                <LinearTriple
                  field={field}
                  value={value}
                  disabled={disabled}
                  onChange={(next) => setField(field.code, next)}
                />
              ) : field.value_kind === 'date' ? (
                <DateField
                  id={`measurement-${field.code}`}
                  data-testid={`measurement-${field.code}`}
                  className="w-40"
                  value={value.value_date || ''}
                  disabled={disabled}
                  onChange={(e) => setField(field.code, { value_date: e.target.value })}
                />
              ) : field.value_kind === 'text' ? (
                <Input
                  id={`measurement-${field.code}`}
                  data-testid={`measurement-${field.code}`}
                  className="w-48"
                  value={value.value_text || ''}
                  disabled={disabled}
                  onChange={(e) => setField(field.code, { value_text: e.target.value })}
                />
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`measurement-${field.code}`}
                    data-testid={`measurement-${field.code}`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="w-24 text-right tabular-nums"
                    // A derived field is readable but not typed into by default. Taking it over is
                    // deliberate: the sonologist clears the placeholder and types, and the server
                    // marks the row an override rather than replacing what they wrote.
                    placeholder={derived ? '—' : ''}
                    value={value.value_1 ?? ''}
                    disabled={disabled}
                    onChange={(e) => setField(field.code, { value_1: e.target.value })}
                  />
                  {field.unit && <span className="text-fine text-slate-500">{field.unit}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
