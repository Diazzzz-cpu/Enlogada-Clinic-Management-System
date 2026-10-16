const { PDFDocument, PDFString, StandardFonts, rgb, degrees } = require('pdf-lib');
const QRCode = require('qrcode');

/**
 * The patient's copy of a report: the clinic's own document, marked DIGITAL COPY. [1.114.0]
 *
 * The clinic hands over the ORIGINAL — printed at the clinic, with its seal. What reaches a patient
 * any other way, in the portal or attached to an email, is a copy, and says so: the words DIGITAL
 * COPY across every page, and a line beneath it telling them where the original is. The staff side
 * is never marked; the clinic prints the original from there.
 *
 * Two rules decide how it is drawn:
 *
 *   - The note goes in a STRIP ADDED BELOW each page, never on the page. A report's last lines are
 *     signatures and licence numbers, and text printed over them would make the copy unreadable
 *     exactly where it matters. Extending the page leaves every mark the clinic made where it was.
 *   - The watermark REPEATS across the whole page, diagonal and faint. It exists to stop the copy
 *     being passed off as the original [1.114.0], and one stamp in the middle can be cropped out or
 *     painted over with the area around it left clean; a pattern leaves no clean region to lift.
 *     Faint enough that every figure under it stays legible.
 *
 * What it is not: a lock. pdf-lib cannot encrypt, and anyone with a PDF editor can try to remove
 * marks. The protection is that the ORIGINAL — sealed, signed, printed — only ever leaves the
 * clinic by hand, and everything else is visibly a copy.
 *
 * PDFs are marked page by page. A JPEG or PNG report becomes a one-page PDF with the image on it, so
 * a patient's copy is always a PDF. A Word document or spreadsheet cannot be marked without
 * converting it, and an unmarked, editable file is the one thing a copy must not be — so those
 * throw NOT_MARKABLE and the caller decides what to say.
 *
 * ── The verification code [1.126.0] ────────────────────────────────────────────────────────────
 *
 * Given the version's verification code, the strip also carries a QR and the code itself, so
 * whoever the patient shows the copy to can check the clinic issued it (utils/verificationCode.js).
 * The QR sits at the strip's right and the note moves into the space beside it, at the same sizes;
 * the strip is taller rather than the note smaller [1.115.0]. The QR is drawn as vector squares, so
 * it stays sharp at any zoom and in print, and a link over it opens the same page from a PDF viewer.
 */

const WATERMARK = 'DIGITAL COPY';
// The note is two lines, the heading in bold, sized to be read at a glance on a phone. [1.115.0]
// At 8pt on one line it was the smallest text on the page, under the report it qualifies.
const NOTE_TITLE = 'DIGITAL COPY';
const NOTE = 'For the original with the official seal, please visit the clinic and ask for it.';
const STRIP = 56;            // points added below each page for the note
const STRIP_VERIFIED = 88;   // the same, with room for the QR and the verification code [1.126.0]
const QR_SIZE = 66;          // points: about 23 mm, which a phone reads off a screen or a print
const IMAGE_WIDTH = 595;     // an image report is laid out at A4 width, so the text sizes match a PDF's
const VERIFY_HINT = 'Scan the QR, or enter the code under Verify a Report on the clinic\'s website, to check this report is genuine.';

const MARKABLE = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** Whether a stored report can be turned into a marked copy. */
const isMarkable = (mimeType) => MARKABLE.has(String(mimeType || '').split(';')[0].trim().toLowerCase());

const notMarkable = () => {
  const error = new Error('This report is a Word document or spreadsheet, which cannot be marked as a digital copy.');
  error.code = 'NOT_MARKABLE';
  return error;
};

/** The largest size, up to `max`, at which `text` fits in `width`. */
const fitSize = (font, text, width, max) => Math.min(max, width / font.widthOfTextAtSize(text, 1));

/**
 * The QR as squares, one rectangle per run of dark modules in a row. Runs rather than single
 * modules keep the page's drawing short, and each overlaps the next row by a hair so no viewer
 * anti-aliases a pale seam between rows, which can stop a scanner.
 */
function drawQr(page, { url, left, bottom, size }) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const unit = size / n;
  const top = bottom + size;
  for (let row = 0; row < n; row += 1) {
    let col = 0;
    while (col < n) {
      if (!modules.get(row, col)) { col += 1; continue; }
      const start = col;
      while (col < n && modules.get(row, col)) col += 1;
      page.drawRectangle({
        x: left + start * unit,
        y: top - (row + 1) * unit - 0.02,
        width: (col - start) * unit,
        height: unit + 0.04,
        color: rgb(0, 0, 0),
      });
    }
  }
}

/** A clickable area over the QR, so the copy opened in a PDF viewer can be checked with one click. */
function linkArea(pdf, page, { url, left, bottom, size }) {
  const annotation = pdf.context.register(pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [left, bottom, left + size, bottom + size],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  }));
  page.node.addAnnot(annotation);
}

function markPage(pdf, page, { bold, regular }, verification) {
  const { x, y, width, height } = page.getMediaBox();
  const strip = verification ? STRIP_VERIFIED : STRIP;

  // The note's strip, below the page. A rotated page has no single "below", so the note goes inside
  // its bottom margin instead; every report the clinic has produced so far is upright.
  const upright = page.getRotation().angle % 360 === 0;
  if (upright) {
    page.setMediaBox(x, y - strip, width, height + strip);
    page.setCropBox(x, y - strip, width, height + strip);
  }

  // The watermark, as a staggered pattern across the ORIGINAL page, every word at the page's own
  // diagonal. Drawn over the report, so no white background in the document can hide it.
  const angle = Math.atan2(height, width);
  const size = fitSize(bold, WATERMARK, width * 0.42, 40);
  const textWidth = bold.widthOfTextAtSize(WATERMARK, size);
  const stepX = textWidth * 1.25;
  const stepY = size * 4.2;
  for (let row = 0, py = y - stepY; py < y + height + stepY; row += 1, py += stepY) {
    // Every other row shifted by half a step, so the words do not stack into columns.
    const offset = (row % 2) * (stepX / 2);
    for (let px = x - stepX + offset; px < x + width + stepX; px += stepX) {
      page.drawText(WATERMARK, {
        x: px,
        y: py,
        size,
        font: bold,
        color: rgb(0.45, 0.45, 0.45),
        opacity: 0.22,
        rotate: degrees((angle * 180) / Math.PI),
      });
    }
  }

  // The strip is cleared AFTER the pattern, which runs into it, so the note sits on plain white,
  // under a hairline that separates it from the report.
  if (upright) {
    page.drawRectangle({ x, y: y - strip, width, height: strip, color: rgb(1, 1, 1) });
    page.drawLine({
      start: { x: x + 18, y: y - 1 },
      end: { x: x + width - 18, y: y - 1 },
      thickness: 0.6,
      color: rgb(0.7, 0.7, 0.7),
    });
  }
  const base = upright ? y - strip : y;

  // With a code, the QR takes the strip's right end and the lines are centred in what is left.
  const qr = verification
    ? { url: verification.url, left: x + width - 18 - QR_SIZE, bottom: base + (strip - QR_SIZE) / 2, size: QR_SIZE }
    : null;
  const textLeft = x + 18;
  const lineWidth = qr ? qr.left - 14 - textLeft : width - 36;
  const centred = (text, font, max, lineY, color) => {
    const size = fitSize(font, text, lineWidth, max);
    page.drawText(text, {
      x: textLeft + (lineWidth - font.widthOfTextAtSize(text, size)) / 2,
      y: lineY,
      size,
      font,
      color,
    });
  };

  if (!qr) {
    centred(NOTE_TITLE, bold, 16, base + 32, rgb(0.1, 0.1, 0.1));
    centred(NOTE, regular, 12, base + 12, rgb(0.15, 0.15, 0.15));
    return;
  }
  centred(NOTE_TITLE, bold, 16, base + 64, rgb(0.1, 0.1, 0.1));
  centred(NOTE, regular, 12, base + 46, rgb(0.15, 0.15, 0.15));
  centred(`Verification code: ${verification.code}`, bold, 12, base + 27, rgb(0.1, 0.1, 0.1));
  centred(VERIFY_HINT, regular, 9, base + 12, rgb(0.3, 0.3, 0.3));
  drawQr(page, qr);
  linkArea(pdf, page, qr);
}

/**
 * @param {Buffer} buffer    the stored report, exactly as uploaded
 * @param {string} mimeType  its validated type
 * @param {object} [options]
 * @param {{code: string, url: string}} [options.verification]  the version's code, as printed
 *   (ABCDE-12345), and the page that checks it [1.126.0]
 * @returns {Promise<Buffer>} a PDF, marked on every page
 * @throws NOT_MARKABLE for a Word document or spreadsheet; pdf-lib's own error for a PDF it
 *   cannot read (encrypted or damaged) — the caller must never fall back to the original.
 */
async function digitalCopy(buffer, mimeType, { verification = null } = {}) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (!MARKABLE.has(type)) throw notMarkable();

  let pdf;
  if (type === 'application/pdf') {
    pdf = await PDFDocument.load(buffer, { updateMetadata: false });
  } else {
    pdf = await PDFDocument.create();
    const image = type === 'image/png' ? await pdf.embedPng(buffer) : await pdf.embedJpg(buffer);
    const scale = IMAGE_WIDTH / image.width;
    const page = pdf.addPage([IMAGE_WIDTH, image.height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: IMAGE_WIDTH, height: image.height * scale });
  }

  const fonts = {
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    regular: await pdf.embedFont(StandardFonts.Helvetica),
  };
  for (const page of pdf.getPages()) markPage(pdf, page, fonts, verification);
  pdf.setSubject('Digital copy. The original is kept at the clinic.');

  return Buffer.from(await pdf.save());
}

/**
 * "CBC - Ana Reyes.pdf" -> "CBC - Ana Reyes (Digital Copy).pdf". Only a real extension is dropped:
 * "Lipid Profile - Ma. Zoe Abao" has a dot in the patient's name, and must keep all of it.
 */
const digitalCopyName = (name) =>
  `${String(name || 'report').replace(/\.[a-z0-9]{1,5}$/i, '')} (Digital Copy).pdf`;

module.exports = {
  digitalCopy, digitalCopyName, isMarkable, WATERMARK, NOTE_TITLE, NOTE, STRIP, STRIP_VERIFIED,
};
