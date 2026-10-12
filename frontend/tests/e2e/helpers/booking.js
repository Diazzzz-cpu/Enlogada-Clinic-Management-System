/**
 * A patient's booking, as the API now requires it. [1.106.0]
 *
 * Every booking a patient makes carries the doctor's signed request, self-pay included, so it is a
 * multipart body with a file — a JSON body from a Client token is refused with 400. Ten specs
 * booked as a patient with `data: {...}`; they all go through here, so the next change to what a
 * booking must carry is made once.
 *
 * Staff bookings are exempt and may stay JSON.
 *
 *   ctx.post(`${API}/appointments`, { headers, multipart: appointmentForm({ patientId, ... }) })
 *
 * Arrays become `name[]` (one test still arrives as an array), an object becomes `name[key]`
 * (`hmo[providerId]`), and null/undefined is left out — the same shapes BookingDialog sends.
 */

/** A 1x1 PNG: genuinely an image, so the server's mime filter sees a real one. */
export const DOCTOR_REQUEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * @param {object} body  the booking's fields, as they used to be sent as JSON
 * @param {object} [options]
 * @param {boolean} [options.doctorRequest=true]  false to leave the file off, for a refusal test
 * @param {boolean} [options.hmoCard=false]       true to attach a card for an HMO claim
 */
export function appointmentForm(body, { doctorRequest = true, hmoCard = false } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => form.append(`${key}[]`, String(v)));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined && v !== null) form.append(`${key}[${k}]`, String(v));
      }
    } else {
      form.append(key, String(value));
    }
  }
  if (doctorRequest) {
    form.append('doctorRequest', new Blob([DOCTOR_REQUEST_PNG], { type: 'image/png' }), 'doctor-request.png');
  }
  if (hmoCard) {
    form.append('hmoCard', new Blob([DOCTOR_REQUEST_PNG], { type: 'image/png' }), 'card.png');
  }
  return form;
}
