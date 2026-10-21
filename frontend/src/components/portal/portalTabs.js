import { CalendarClock, FileText, Home as HomeIcon, Receipt, Users } from 'lucide-react';

/**
 * The patient portal's tabs, in order: Home, then the four it summarises. [1.81.0]
 *
 * The labels are test contracts. tests/e2e/helpers/portal.js holds the same words, so a rename here
 * is a rename there. In a file of its own because a component file that also exports a constant
 * cannot be hot-reloaded.
 */
export const PORTAL_TABS = [
  { value: 'home', label: 'Home', icon: HomeIcon },
  // "Visits", not "Appointments" [1.136.0]: it lists walk-in visits too, and a walk-in filed
  // under Appointments reads as something the patient booked online. The value is unchanged.
  { value: 'appointments', label: 'Visits', icon: CalendarClock },
  { value: 'results', label: 'Results', icon: FileText },
  { value: 'payments', label: 'Payments', icon: Receipt },
  { value: 'profile', label: 'Profile', icon: Users },
];
