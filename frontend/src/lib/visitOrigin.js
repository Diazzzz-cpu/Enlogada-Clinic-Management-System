/**
 * How a visit came about, in the words the patient reads. [1.136.0]
 *
 * The server decides it (`came_in_as`, backend/src/constants/visits.js CAME_IN_AS) from what was
 * stored when the visit was made; this only names it. A walk-in must never read as an online
 * booking, which is what a walk-in record shown under "Appointments" would have said.
 */
export const ORIGINS = {
  walk_in: { label: 'Walk-in at the clinic', short: 'Walk-in' },
  online: { label: 'Booked online', short: 'Booked online' },
  clinic: { label: 'Booked by the clinic', short: 'Booked by the clinic' },
};

/**
 * The origin of a visit row. Falls back on `visit_type` for a row that predates `came_in_as`, so a
 * walk-in is still called one; a booking with no stored origin is not guessed at.
 */
export function visitOrigin(row) {
  const key = row?.came_in_as;
  if (ORIGINS[key]) return { key, ...ORIGINS[key] };
  if (row?.visit_type === 'Walk in') return { key: 'walk_in', ...ORIGINS.walk_in };
  return null;
}

/** A walk-in visit: what the portal lists apart from bookings, which have their own cards. */
export const isWalkIn = (row) => visitOrigin(row)?.key === 'walk_in';
