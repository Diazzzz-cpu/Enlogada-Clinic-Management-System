import React from 'react';
import { formatDateTimeParts } from '../../lib/date';

/**
 * A date and time that wraps only between the two: "Oct 18, 2026," then "7:35 PM", never "PM" on
 * a line of its own. [1.130.0] Use it wherever a table cell shows `formatDateTime`.
 */
export default function DateTime({ value, className }) {
  const parts = formatDateTimeParts(value);
  if (!parts) return <span className={className}>—</span>;
  return (
    <span className={className}>
      <span className="whitespace-nowrap">{parts.date},</span>{' '}
      <span className="whitespace-nowrap">{parts.time}</span>
    </span>
  );
}
