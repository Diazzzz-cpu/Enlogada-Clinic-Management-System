// @ts-check
import { test, expect, request } from 'playwright/test';
import { selfPayProfile } from './helpers/patients.js';
import { appointmentForm, bookableTestId, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay, dateStr } from './helpers/dates.js';
import { runScript } from './helpers/backendScript.js';

/**
 * Appointment reminders are planned by the server itself. [1.130.0]
 *
 * The server sweeps every minute and sends each reminder when it falls due: the evening before at
 * 18:00, or halfway to a booking made later than that (the rules are unit-tested in
 * backend/tests/unit/reminderTiming.test.js). This checks the plan the server works from for a
 * real booking: that it is there, when it is due, and that moving the booking moves its reminder.
 * Nothing is sent: the booking is days away, and the seeded client's address is never mailed.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

const planFor = (reference) => {
  const plan = JSON.parse(runScript('sendAppointmentReminders.js', ['--json', '--days=14'], 'the reminder plan')
    .split('\n').find((line) => line.startsWith('[')) || '[]');
  return plan.find((r) => r.reference === reference);
};

/** 18:00 on the day before `date` ('YYYY-MM-DD'), as the plan prints it. */
const eveningBefore = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${dateStr(new Date(y, m - 1, d - 1))} 18:00`;
};

test('a booking is planned a reminder for the evening before, and a move plans it again', async () => {
  const ctx = await request.newContext();
  const token = (await (await ctx.post(`${API}/auth/login`, {
    data: { email: 'client@enlogada.com', password: PASSWORD },
  })).json()).data.token;
  const auth = { Authorization: `Bearer ${token}` };
  const patientId = selfPayProfile((await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth })).json()).data.patients).id;

  const free = async (date) => ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth })).json())
    .data.slots || []).filter((s) => s.available);
  const first = nthWorkingDay(3);
  const moved = nthWorkingDay(4);
  const [slot] = await free(first);
  const [later] = await free(moved);
  test.skip(!slot || !later, 'no free slot on the days this needs');

  const booked = await ctx.post(`${API}/appointments`, {
    headers: auth,
    multipart: appointmentForm({ patientId, scheduledDate: first, scheduledTime: slot.time, testIds: [await bookableTestId(ctx)] }),
  });
  expect(booked.status(), await booked.text()).toBe(201);
  const appt = (await booked.json()).data.appointment;

  try {
    const planned = planFor(appt.appointment_reference);
    expect(planned, 'the new booking is owed a reminder').toBeTruthy();
    expect(planned.kind).toBe('evening-before');
    expect(planned.dueAt).toBe(eveningBefore(first));
    expect(planned.action, 'days away: not yet').toBe('wait');

    const res = await ctx.put(`${API}/appointments/${appt.id}/reschedule`, {
      headers: auth, data: { scheduledDate: moved, scheduledTime: later.time, reason: 'Schedule conflict' },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(planFor(appt.appointment_reference)?.dueAt, 'the reminder follows the booking').toBe(eveningBefore(moved));
  } finally {
    removeUnpaid(appt.id);
  }

  // Removed (unpaid, as its time running out would): nobody is reminded about it.
  expect(planFor(appt.appointment_reference)).toBeUndefined();
  await ctx.dispose();
});
