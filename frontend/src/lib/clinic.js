import { useSyncExternalStore } from 'react';

/**
 * The clinic's own identity, in one place.
 *
 * These strings were previously only in PublicFooter.jsx, as markup. That was fine while a footer
 * was the only thing that needed them — it stopped being fine the moment a printed receipt did,
 * because a receipt with a different address from the website is a document nobody can rely on.
 *
 * ── Why this is fetched rather than compiled in ───────────────────────────────────────────────
 * It used to read `VITE_CLINIC_TIN` and friends from `import.meta.env`, which Vite inlines at
 * BUILD time. Setting the clinic's TIN therefore meant editing `frontend/.env` and running
 * `npm run build` — an operation a clinic administrator will never perform, which is exactly why
 * the field was still empty and the receipt still printing "not a BIR-registered Official
 * Receipt" long after the feature existed. A correct mechanism nobody can operate is not a
 * working mechanism.
 *
 * `GET /api/clinic` reads the same values from the backend's environment, so setting them is a
 * `backend/.env` edit and a restart — the same operation as changing the SMTP password.
 *
 * The build-time values below are kept as the fallback, so a frontend that cannot reach the API
 * (the login page on a cold start, a network blip) still renders the clinic's name and address
 * rather than blanks.
 *
 * ── The statutory fields stay blank unless configured ─────────────────────────────────────────
 * `tin`, `businessPermit` and `accreditation` are NOT given plausible defaults, and that is the
 * whole point: a BIR-compliant official receipt must carry the issuer's real TIN, and a made-up
 * one on a document a patient files for reimbursement is worse than no number at all — it is a
 * false record. The receipt prints without them and says so, until someone who knows the real
 * values sets them.
 */
const env = import.meta.env || {};

/** What ships in the bundle. Contact details are real; statutory identifiers are deliberately blank. */
export const CLINIC_DEFAULTS = Object.freeze({
  name: 'Enlogada Ultrasound & Diagnostic Clinic',
  shortName: 'ENLOGADA',
  // The services line the clinic prints beneath its name on every result form. [1.52.0] Their own
  // forms separate them with a REGISTERED SIGN, which is a Wingdings bullet that lost its symbol
  // font somewhere — reproduced here as the bullet it was meant to be.
  services: 'LABORATORY • ULTRASOUND • X-RAY',
  // Corrected from 'Bugo, Cagayan de Oro, Philippines 9000' in [1.52.0]. The clinic's own printed
  // result form carries the fuller address, and the printed document is the authority: a report
  // whose address differs from the one on the clinic's letterhead is a document nobody can rely on.
  address: 'National Highway, Diesto Building, Bugo, Cagayan de Oro City, Misamis Oriental, 9000',
  phone: '0936 132 0650',
  email: 'enlogadaclinic2011@gmail.com',
  proprietor: '',

  // A string, not a boolean, so it merges through the same "use it if non-empty" rule as every
  // other field. Defaults to VAT-registered because that is the stricter, safer assumption: it
  // makes the receipt claim LESS (no input-tax wording) rather than more, if the server is
  // unreachable and this fallback is what renders.
  vatRegistered: 'true',

  // Still honoured if someone does set them at build time, so nothing that worked before breaks.
  // Trimmed here as well as on the server: an env value of "   " is otherwise truthy, and a run of
  // spaces in the TIN would satisfy a presence check while printing nothing.
  tin: (env.VITE_CLINIC_TIN || '').trim(),
  businessPermit: (env.VITE_CLINIC_PERMIT || '').trim(),
  accreditation: (env.VITE_CLINIC_ACCREDITATION || '').trim(),
});

let current = CLINIC_DEFAULTS;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getSnapshot = () => current;

/**
 * Merges whatever the server supplies over the defaults.
 *
 * Only non-empty values win. The endpoint returns every field, blank when unset, so this is a
 * plain overwrite-if-present rather than a distinction between absent and empty — which means an
 * operator who sets only CLINIC_TIN keeps the built-in name and address instead of blanking them.
 */
export function applyClinicIdentity(fromServer) {
  if (!fromServer) return;
  const merged = { ...CLINIC_DEFAULTS };
  for (const [key, value] of Object.entries(fromServer)) {
    if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
  }
  current = Object.freeze(merged);
  notify();
}

/**
 * The clinic identity, re-rendering when the fetched values arrive.
 *
 * useSyncExternalStore rather than a context provider: two components need this and neither is
 * near a natural provider boundary, so a provider would exist only to thread one object down.
 */
export const useClinic = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** The current values, for code outside React (printing, PDF generation). */
export const getClinic = () => current;

/**
 * Values that are obviously stand-ins: anything saying so in words, and anything whose digits are
 * all zeros. A real TIN or permit number never looks like either.
 *
 * This exists so a sample configuration cannot quietly become a live one. Someone pastes the
 * sample block in to see the receipt laid out with every field populated, and then the clinic
 * opens — and without this the only thing standing between that and handing a patient a document
 * bearing a made-up TIN is somebody remembering.
 */
const PLACEHOLDER_WORDS = /sample|placeholder|example|to-?be-?(provided|supplied)|tbd|xxx/i;
const isPlaceholder = (value) => {
  const v = (value || '').trim();
  if (!v) return false;
  if (PLACEHOLDER_WORDS.test(v)) return true;
  const digits = v.replace(/\D/g, '');
  return digits.length > 0 && /^0+$/.test(digits);
};

/**
 * A field with something in it. Trimmed, because `Boolean('   ')` is `true` — and a bare
 * truthiness check on these fields printed "Official Receipt" for a clinic whose TIN and permit
 * were both a run of spaces. Found by testing the predicate rather than reading it.
 */
const isFilled = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Whether the clinic charges VAT.
 *
 * A non-VAT establishment's invoice must say so — the clinic's own booklet carries "Non VAT Reg.
 * TIN" and "THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES", because a patient or their
 * employer could otherwise try to claim input tax against a document that cannot support it.
 *
 * It also decides how a senior/PWD discount is computed, server-side: a VAT-registered clinic
 * strips the 12% before applying the 20% (RA 9994 / RA 10754), a non-VAT one does not. Getting
 * that backwards moves real money — 85.71 per 1,000 on this clinic's numbers.
 */
export const isVatRegistered = (clinic = current) => clinic?.vatRegistered !== 'false';

/** True when any statutory field is a stand-in, so the document must say so. */
export const isSampleIdentity = (clinic = current) =>
  isPlaceholder(clinic?.tin) || isPlaceholder(clinic?.businessPermit) || isPlaceholder(clinic?.accreditation);

/**
 * Whether this may print as a BIR Official Receipt.
 *
 * Gated on the **permit** — the Authority to Print, or the Permit to Use for a computerised
 * system — and not on the TIN, which is the rule this used to apply and which was too generous. A
 * TIN identifies the taxpayer; it does not authorise anybody to issue an official receipt. A
 * clinic that is registered but has no ATP/PTU still cannot, so keying the wording to the TIN
 * would have printed "Official Receipt" on a document that is not one — the same false-record
 * problem the blank default was there to prevent, moved one step along.
 *
 * A placeholder in either field disqualifies it outright.
 *
 * Takes the identity rather than reading module state, so a component that got its copy from
 * useClinic cannot ask this question about a different snapshot than the one it is rendering.
 */
export const hasStatutoryIdentity = (clinic = current) =>
  isFilled(clinic?.tin) &&
  isFilled(clinic?.businessPermit) &&
  !isSampleIdentity(clinic);

/**
 * Backwards-compatible named export.
 *
 * Deliberately the DEFAULTS, not a live snapshot: a module-level import is captured once, so a
 * mutable object here would hand callers stale values with no indication. Anything that needs the
 * configured identity uses useClinic() (React) or getClinic() (everything else).
 */
export const CLINIC = CLINIC_DEFAULTS;
