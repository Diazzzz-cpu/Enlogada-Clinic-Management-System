/**
 * The clinic's own identity, served at runtime.
 *
 * These values already existed on the frontend as build-time `VITE_CLINIC_*` constants, and that
 * was the wrong mechanism for who has to set them. Vite inlines `import.meta.env` when the bundle
 * is built, so entering the clinic's TIN meant editing `frontend/.env` and running `npm run
 * build` — which is not something a clinic administrator will ever do, and is why the field was
 * still empty months after it was added. The receipt consequently kept printing "not a
 * BIR-registered Official Receipt" with no practical route to changing that.
 *
 * Reading them here instead makes it a backend `.env` edit and a restart: the same operation as
 * changing the SMTP password, which somebody does actually perform.
 *
 * Public and unauthenticated on purpose. Every field is already printed on the public website's
 * footer, on the services page and on any receipt handed across the counter — a TIN and a
 * business permit are published identifiers, not secrets. Gating them would only mean the login
 * page could not render the clinic's own address.
 *
 * Anything unset is returned as an empty string rather than omitted, so the frontend's merge is a
 * plain "use this if it is non-empty" and never has to distinguish absent from blank.
 */
const env = (name) => (process.env[name] || '').trim();

class ClinicController {
  async getIdentity(req, res, next) {
    try {
      return res.status(200).json({
        status: 'success',
        data: {
          clinic: {
            // Contact details, overridable but rarely changed — the frontend keeps sensible
            // defaults for these, so an unset value here simply leaves the built-in one alone.
            name: env('CLINIC_NAME'),
            shortName: env('CLINIC_SHORT_NAME'),
            address: env('CLINIC_ADDRESS'),
            // The services line printed beneath the clinic name on every result form. [1.52.0]
            services: env('CLINIC_SERVICES'),
            phone: env('CLINIC_PHONE'),
            email: env('CLINIC_EMAIL'),
            // A sole proprietorship's receipts name the proprietor; the clinic's own invoice
            // booklet prints "JESIE B. ENLOGADA - Prop." beneath the trade name.
            proprietor: env('CLINIC_PROPRIETOR'),

            // Whether the clinic is VAT-registered, as a string so it travels through the same
            // "use it if non-empty" merge as every other field. It belongs on the receipt for
            // the same reason it is stamped on the paper booklet: a non-VAT invoice cannot be
            // used to claim input taxes, and the document has to say so. Mirrors
            // CLINIC_VAT_REGISTERED, which also drives how a senior/PWD discount is computed.
            vatRegistered: process.env.CLINIC_VAT_REGISTERED === 'false' ? 'false' : 'true',

            // The statutory identifiers. Blank unless configured, and deliberately given no
            // fallback anywhere: an invented TIN on a document a patient files for reimbursement
            // is a false record, which is worse than an obviously provisional one.
            tin: env('CLINIC_TIN'),
            businessPermit: env('CLINIC_PERMIT'),
            accreditation: env('CLINIC_ACCREDITATION'),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ClinicController();
