import React from 'react';
import { cn } from '../../lib/utils';
import { analyseFindings } from '../../lib/abnormalValues';

/**
 * Findings, with out-of-range values made findable. [1.63.0]
 *
 * A CBC panel is eight lines of near-identical text and the reader has to compare each value
 * against a range printed beside it. On a released report that check happens under time pressure,
 * and the two the clinician most needs to see look exactly like the six they do not.
 *
 * ── Never colour alone, and here that rule is doubly load-bearing ───────────────────────────
 *
 * Each abnormal line gets THREE independent signals: a bold weight, an explicit `HIGH`/`LOW` tag,
 * and a tinted background. Colour is the one a red-green colour blind reader may not have — but
 * it is also the one that DISAPPEARS IN PRINT, because browsers drop background colours by
 * default, and this text is rendered inside `DiagnosticReport`, which is a document the clinic
 * prints and hands over.
 *
 * So the tag is the primary carrier and the colour is reinforcement. A printed report still reads
 * "Hemoglobin: 11.2 g/dL (Normal: 13.0 - 17.5)  LOW" in bold, on a monochrome laser printer.
 *
 * ── It marks abnormal and never marks normal ────────────────────────────────────────────────
 *
 * A line the parser cannot read is rendered exactly as typed. The failure mode is therefore a
 * missed highlight, which leaves the reader where they were before this component existed; the
 * opposite failure would be an assurance the software is not entitled to give.
 *
 * This does not replace the critical-value workflow. A panic value is still flagged by the
 * clinician and still needs a recorded callback — highlighting it here does not discharge that,
 * and nothing in this file writes anything.
 */
const FindingsText = ({ findings, className }) => {
  const lines = analyseFindings(findings);

  if (!lines.length) {
    return <p className={cn('m-0 text-ink-muted', className)}>—</p>;
  }

  return (
    // `whitespace-pre-wrap` on each line rather than the block: a technician's findings carry
    // their own line breaks and losing them turns a panel into a paragraph.
    <div className={cn('space-y-0.5', className)}>
      {lines.map((line, i) => {
        if (!line.flag) {
          return (
            // Blank lines are structure — they separate the panel from the impression — so they
            // are preserved rather than collapsed.
            <p key={i} className="m-0 whitespace-pre-wrap">
              {line.text || ' '}
            </p>
          );
        }

        const isHigh = line.flag === 'high';
        return (
          <p
            key={i}
            className={cn(
              'm-0 flex flex-wrap items-baseline gap-x-2 whitespace-pre-wrap rounded px-1.5 py-0.5 font-semibold',
              isHigh
                ? 'bg-rose-50 text-rose-800'
                : 'bg-amber-50 text-amber-900'
            )}
          >
            <span>{line.text}</span>
            {/* The tag, not the colour, is what survives a monochrome print. `aria-label` spells
                it out because "HIGH" read alone gives no indication of what is high. */}
            <span
              aria-label={`${line.label} is ${isHigh ? 'above' : 'below'} the reference range`}
              className={cn(
                'rounded px-1 text-nano font-bold uppercase tracking-wider ring-1 ring-inset',
                isHigh
                  ? 'bg-rose-100 text-rose-900 ring-rose-300'
                  : 'bg-amber-100 text-amber-900 ring-amber-300'
              )}
            >
              {isHigh ? 'High' : 'Low'}
            </span>
          </p>
        );
      })}
    </div>
  );
};

export default FindingsText;
