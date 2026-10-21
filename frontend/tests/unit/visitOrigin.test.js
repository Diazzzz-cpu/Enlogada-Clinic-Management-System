import { describe, it, expect } from 'vitest';
import { visitOrigin, isWalkIn } from '../../src/lib/visitOrigin.js';

describe('how a visit came about [1.136.0]', () => {
  it('names each origin the server sends', () => {
    expect(visitOrigin({ came_in_as: 'walk_in' }).label).toBe('Walk-in at the clinic');
    expect(visitOrigin({ came_in_as: 'online' }).label).toBe('Booked online');
    expect(visitOrigin({ came_in_as: 'clinic' }).label).toBe('Booked by the clinic');
  });

  it('a walk-in is never called a booking, even on a row with no stored origin', () => {
    expect(visitOrigin({ visit_type: 'Walk in' }).key).toBe('walk_in');
    expect(isWalkIn({ visit_type: 'Walk in' })).toBe(true);
    expect(isWalkIn({ came_in_as: 'online', visit_type: 'Appointment' })).toBe(false);
  });

  it('does not guess at a booking it was told nothing about', () => {
    expect(visitOrigin({ visit_type: 'Appointment' })).toBeNull();
    expect(visitOrigin(null)).toBeNull();
  });
});
