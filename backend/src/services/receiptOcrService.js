const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const logger = require('../config/logger');
const paymentSubmissionRepository = require('../repositories/paymentSubmissionRepository');

/**
 * Reads a GCash / bank transfer screenshot and offers the cashier what it thinks it says.
 * [1.62.0]
 *
 * ── This NEVER decides money. It types. ─────────────────────────────────────────────────────
 *
 * The single most important property of this file, and the reason it is shaped as a read-only
 * helper with no writes anywhere in it.
 *
 * [1.48.0] settled the rule that the amount a patient CLAIMS is evidence, never the amount they
 * are charged — approval always records the recomputed bill, which is why the review queue shows
 * `amount_due` beside `amount_claimed`. An OCR pass is a THIRD, even weaker source: it is a guess
 * about a claim about a payment. Letting it write a figure anywhere would quietly promote the
 * least reliable number in the system to the most authoritative.
 *
 * So the endpoint returns a suggestion and nothing else. It creates no submission, touches no
 * payment, and the cashier's verify path is completely unchanged — it still runs
 * `paymentService.processPayment` against the recomputed bill. What this actually saves is the
 * retyping of a 13-digit reference number from a phone screenshot, which is where the errors
 * were: a transposed digit in a reference is a payment nobody can later find.
 *
 * ── The duplicate check is the part with real value ─────────────────────────────────────────
 *
 * A reference number is the clinic's only handle on a transfer that happened somewhere else. The
 * same screenshot submitted twice — forwarded to a second visit, or re-sent because the patient
 * was unsure it went through — is indistinguishable from two genuine payments unless somebody
 * checks. Nobody was checking, because checking meant reading a number off an image and searching
 * for it.
 *
 * Both tables are searched, and both matter: `payment_submissions` catches a claim already in the
 * queue or already decided, and `payments` catches one a cashier settled at the counter. Checking
 * only the first would miss exactly the case that costs money.
 *
 * ── Failure is soft, always ─────────────────────────────────────────────────────────────────
 *
 * Tesseract needs its language data, which it fetches once and caches. An offline clinic, a
 * corrupt cache, a screenshot that is mostly a photograph of a phone — all of these produce no
 * text, and none of them may break the upload. Every failure path here returns nulls with a
 * `scanned: false` and a reason; the form stays exactly as usable as it was before this existed.
 * An assistant that can break the thing it assists is worse than no assistant.
 */

// Where the language data is cached. Kept inside the backend rather than in the OS temp
// directory so a machine that has scanned once keeps working after a reboot, and so an air-gapped
// clinic can have the file placed here by hand.
const OCR_CACHE_PATH = path.join(__dirname, '..', '..', 'uploads', '.ocr-cache');
try {
  fs.mkdirSync(OCR_CACHE_PATH, { recursive: true });
} catch (err) {
  logger.warn(`Could not create the OCR cache directory (${err.message}). Receipt scanning may re-download its language data on every call.`);
}

// A scan that has not finished by now is not going to help anybody: the patient is sitting in
// front of an upload form. Bounded so a pathological image cannot occupy a request indefinitely.
const SCAN_TIMEOUT_MS = 20000;

// Idle workers are torn down. A Tesseract worker holds tens of megabytes of language data
// resident; keeping one alive forever to serve a handful of scans a day is the wrong trade, and
// creating one per scan costs a second or two of initialisation that the patient waits through.
// Reuse it while scans are arriving, release it when they stop.
const WORKER_IDLE_MS = 120000;

let workerPromise = null;
let idleTimer = null;
// Scans are serialised through this chain. A Tesseract worker processes one job at a time, and
// two concurrent `recognize` calls on one worker interleave into a single garbled result — so
// the queue is not a throttle, it is a correctness requirement.
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      cachePath: OCR_CACHE_PATH,
      // Tesseract's own progress chatter is per-percent and would swamp the request log.
      logger: () => {},
    }).catch((err) => {
      // Do not leave a rejected promise cached — the next call must be free to try again, since
      // the usual cause is a transient network failure fetching the language data.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function scheduleWorkerRelease() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const pending = workerPromise;
    workerPromise = null;
    idleTimer = null;
    try {
      const worker = await pending;
      if (worker) await worker.terminate();
    } catch {
      // Nothing to release, or it failed to start in the first place.
    }
  }, WORKER_IDLE_MS);
  // Never hold the process open for a cache eviction — this must not keep `node` alive at exit.
  if (idleTimer.unref) idleTimer.unref();
}

/**
 * ── Reference number ─────────────────────────────────────────────────────────────────────────
 *
 * Two passes, in order of confidence.
 *
 * The LABELLED pass looks for the words a receipt actually prints — "Ref No.", "Reference Number",
 * "Transaction ID" — and takes what follows. This is by far the more reliable, because it uses the
 * receipt's own structure rather than guessing from shape.
 *
 * The UNLABELLED pass exists because OCR routinely mangles the label itself ("Ref No." becomes
 * "Rel No,"), and a long digit run on a payment receipt is almost always the reference. It is
 * deliberately narrow — 10 to 16 digits — because a shorter run is a date, an amount or a phone
 * number, and taking one of those would be worse than returning nothing: a wrong pre-filled
 * reference that looks plausible is harder to catch than an empty box.
 *
 * `matchedOn` travels back with the answer so the frontend can say which pass found it, and so a
 * low-confidence guess can be presented as a guess.
 */
const LABELLED_REFERENCE = new RegExp(
  // The label, tolerating the punctuation and spacing OCR introduces.
  //
  // `[.:,]?\\s*` between the two words is load-bearing: the commonest spelling on a real GCash
  // receipt is "Ref. No. 1029…", and without allowing that first full stop the label pass misses
  // it entirely and the answer falls through to the weaker digit-run guess. Measured on a rendered
  // receipt — it reported matched_on 'digit-run' for the one format this is most likely to see.
  '(?:ref(?:erence)?\\s*[.:,]?\\s*(?:no|num|number|#)?|transaction\\s*[.:,]?\\s*(?:id|no|number)|txn\\s*[.:,]?\\s*(?:id|no)?|trace\\s*[.:,]?\\s*no)'
  + '\\s*[:.#,-]?\\s*'
  // The value, ALPHANUMERIC and not digits-only.
  //
  // GCash issues a bare 13-digit reference, which is what the digits-only version of this pattern
  // was built for. Banks do not: BPI, BDO and UnionBank all prefix or hyphenate, and this clinic's
  // own records already hold references shaped like `GC-1787890589109`. A digits-only capture
  // silently truncates those to the numeric tail — producing a reference that looks right, is
  // wrong, and no longer matches the one already stored, so the duplicate check quietly stops
  // working on exactly the receipts most likely to be duplicated.
  //
  // HORIZONTAL whitespace only — `[^\\S\\r\\n]`, not `\\s`. `\\s` matches a newline, so the
  // capture ran off the end of the reference line and swallowed the start of the next one:
  // measured on a rendered receipt, "Ref. No. E2E-1787890589109" followed by a date line came
  // back as `E2E-1787890589109Aug28`. That is worse than finding nothing, because it is a
  // plausible-looking reference that matches no record — so the duplicate check silently returns
  // clean on exactly the receipt it was meant to catch.
  + '([A-Z0-9][A-Z0-9 \\t_-]{4,28}[A-Z0-9])',
  'i'
);

const UNLABELLED_REFERENCE = /\b(\d{10,16})\b/;

/**
 * Turns the raw run captured after a label into a reference, or null.
 *
 * Spaces inside the run mean two different things depending on what is on either side, and
 * collapsing that distinction is what produced `E2E-1787890589109Aug28`:
 *
 *   all tokens are DIGITS      OCR split one long number — "1029 3847 5612 3". Join them.
 *   anything else              a bank reference is a single token; whatever follows the space is
 *                              the next field on the receipt, not part of it. Take the first
 *                              token that looks like a reference and stop.
 *
 * "Looks like a reference" is at least four digits. Without that test the widened, letter-tolerant
 * pattern happily returns "Successful" from "Ref No. Successful" — a real line on a real receipt
 * when OCR loses the number — and a field that fills itself with a plausible wrong value is worse
 * than one that stays empty, because nobody re-reads a box that already has something in it.
 */
function cleanReferenceRun(run) {
  const tokens = String(run).trim().split(/[ \t]+/).filter(Boolean);
  if (!tokens.length) return null;

  const digitsOnly = (s) => /^\d+$/.test(s);
  const enoughDigits = (s) => (s.match(/\d/g) || []).length >= 4;
  const tidy = (s) => s.replace(/[-_]+$/, '');

  if (tokens.every(digitsOnly)) {
    const joined = tokens.join('');
    return joined.length >= 6 ? joined : null;
  }

  const candidate = tokens.map(tidy).find((t) => t.length >= 6 && enoughDigits(t));
  return candidate || null;
}

function extractReferenceNumber(text) {
  const labelled = LABELLED_REFERENCE.exec(text);
  if (labelled) {
    const cleaned = cleanReferenceRun(labelled[1]);
    if (cleaned) return { value: cleaned, matchedOn: 'label' };
  }

  const bare = UNLABELLED_REFERENCE.exec(text);
  if (bare) return { value: bare[1], matchedOn: 'digit-run' };

  return { value: null, matchedOn: null };
}

/**
 * ── Amount ───────────────────────────────────────────────────────────────────────────────────
 *
 * Peso amounts on a GCash receipt appear several times — "Amount", "Total Amount Sent", and often
 * a fee. Every labelled candidate is collected and the LARGEST is taken, because the figure the
 * patient is claiming is the total they sent, and a fee line would otherwise win by appearing
 * first.
 *
 * `₱` is included but not relied on: Tesseract reads it as `P`, P, P or nothing at all depending
 * on the font, which is why the currency alternation is as loose as it is.
 *
 * Thousands separators are the trap. OCR confuses `,` and `.` constantly, so "1,450.00" can
 * arrive as "1.450,00" or "1,450,00". The parser therefore treats the LAST separator followed by
 * exactly two digits as the decimal point and strips everything else — which reads all three
 * spellings as 1450.00, and correctly leaves "1,450" as 1450 rather than 1.45.
 */
const AMOUNT_CANDIDATE = new RegExp(
  '(?:amount|total|paid|php|piso|peso|\\u20b1)'
  + '[^0-9\\n]{0,18}'
  + '([0-9][0-9.,\\s]{0,15}[0-9]|[0-9])',
  'gi'
);

function parseAmountToken(token) {
  const trimmed = String(token).replace(/\s/g, '');
  // A separator followed by exactly two digits at the end is a decimal point, whichever
  // character OCR chose for it.
  const decimal = /^(.*)[.,](\d{2})$/.exec(trimmed);
  if (decimal) {
    const whole = decimal[1].replace(/[.,]/g, '');
    if (!whole) return null;
    const value = Number(`${whole}.${decimal[2]}`);
    return Number.isFinite(value) ? value : null;
  }
  const whole = trimmed.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  const value = Number(whole);
  return Number.isFinite(value) ? value : null;
}

function extractAmount(text) {
  const candidates = [];
  let match;
  AMOUNT_CANDIDATE.lastIndex = 0;
  while ((match = AMOUNT_CANDIDATE.exec(text)) !== null) {
    const value = parseAmountToken(match[1]);
    // An upper bound as a sanity filter, not a business rule: a run of digits read out of a
    // reference number can parse as a number in the millions, and offering that as an amount is
    // how somebody ends up staring at a ₱1,029,384.00 claim on a ₱950 visit.
    if (value !== null && value > 0 && value < 1000000) candidates.push(value);
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

class ReceiptOcrService {
  /**
   * OCRs an image buffer and reports what it found, plus whether that reference is already known.
   *
   * Returns a suggestion, never a decision. Nothing here writes.
   */
  async scan(buffer, originalName = '') {
    const result = {
      scanned: false,
      reference_number: null,
      amount: null,
      is_duplicate: false,
      duplicate_of: null,
      matched_on: null,
      confidence: null,
      reason: null,
    };

    let text = '';
    try {
      const recognised = await this.recognise(buffer);
      text = recognised.text;
      // Tesseract's own mean confidence over the page, 0-100. Reported so the UI can present a
      // poor read AS a poor read — a pre-filled field carries an authority the value may not have
      // earned, and "check this against your receipt" is the right prompt for a blurry photo.
      result.confidence = Number.isFinite(recognised.confidence)
        ? Math.round(recognised.confidence)
        : null;
      result.scanned = true;
    } catch (err) {
      // Soft failure by design — see the header note. The upload form must remain usable.
      logger.warn(`Receipt OCR failed for "${originalName}": ${err.message}`);
      result.reason = 'The image could not be read automatically. Please type the details in.';
      return result;
    }

    const reference = extractReferenceNumber(text);
    result.reference_number = reference.value;
    result.matched_on = reference.matchedOn;
    result.amount = extractAmount(text);

    if (!result.reference_number && result.amount === null) {
      result.reason = 'No reference number or amount was recognised in this image.';
      return result;
    }

    if (result.reference_number) {
      const existing = await paymentSubmissionRepository.findByReferenceNumber(result.reference_number);
      if (existing) {
        result.is_duplicate = true;
        result.duplicate_of = existing;
      }
    }

    return result;
  }

  /**
   * One recognition, serialised behind any scan already running and bounded by a timeout.
   *
   * The timeout races the recognition rather than cancelling it — Tesseract offers no cancel — so
   * a genuinely stuck job still occupies its worker. That is acceptable because the worker is
   * per-process and the next request creates its own queue entry behind it; what matters is that
   * the HTTP request returns.
   */
  async recognise(buffer) {
    const run = async () => {
      const worker = await getWorker();
      const recognition = worker.recognize(buffer);
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Reading the image took too long.')), SCAN_TIMEOUT_MS);
      });
      try {
        const { data } = await Promise.race([recognition, timeout]);
        return { text: data?.text || '', confidence: data?.confidence };
      } finally {
        clearTimeout(timer);
        scheduleWorkerRelease();
      }
    };

    // Chain, but never let one failed scan poison the queue for the next caller.
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }
}

module.exports = new ReceiptOcrService();
// Exported for the unit checks in scripts/testReceiptOcr.js — the parsing is the part worth
// testing without spinning up Tesseract.
module.exports.__parsers = { extractReferenceNumber, extractAmount, parseAmountToken };
