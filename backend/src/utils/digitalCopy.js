const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

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
 */

const WATERMARK = 'DIGITAL COPY';
const NOTE = 'DIGITAL COPY. For the original with the official seal, please visit the clinic and ask for it.';
const STRIP = 26;            // points added below each page for the note
const IMAGE_WIDTH = 595;     // an image report is laid out at A4 width, so the text sizes match a PDF's

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

function markPage(page, { bold, regular }) {
  const { x, y, width, height } = page.getMediaBox();

  // The note's strip, below the page. A rotated page has no single "below", so the note goes inside
  // its bottom margin instead; every report the clinic has produced so far is upright.
  const upright = page.getRotation().angle % 360 === 0;
  if (upright) {
    page.setMediaBox(x, y - STRIP, width, height + STRIP);
    page.setCropBox(x, y - STRIP, width, height + STRIP);
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

  // The strip is cleared AFTER the pattern, which runs into it, so the note sits on plain white.
  if (upright) {
    page.drawRectangle({ x, y: y - STRIP, width, height: STRIP, color: rgb(1, 1, 1) });
  }
  const noteSize = fitSize(regular, NOTE, width - 24, 8);
  const noteWidth = regular.widthOfTextAtSize(NOTE, noteSize);
  page.drawText(NOTE, {
    x: x + (width - noteWidth) / 2,
    y: upright ? y - STRIP + 9 : y + 6,
    size: noteSize,
    font: regular,
    color: rgb(0.2, 0.2, 0.2),
  });
}

/**
 * @param {Buffer} buffer    the stored report, exactly as uploaded
 * @param {string} mimeType  its validated type
 * @returns {Promise<Buffer>} a PDF, marked on every page
 * @throws NOT_MARKABLE for a Word document or spreadsheet; pdf-lib's own error for a PDF it
 *   cannot read (encrypted or damaged) — the caller must never fall back to the original.
 */
async function digitalCopy(buffer, mimeType) {
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
  for (const page of pdf.getPages()) markPage(page, fonts);
  pdf.setSubject('Digital copy. The original is kept at the clinic.');

  return Buffer.from(await pdf.save());
}

/**
 * "CBC - Ana Reyes.pdf" -> "CBC - Ana Reyes (Digital Copy).pdf". Only a real extension is dropped:
 * "Lipid Profile - Ma. Zoe Abao" has a dot in the patient's name, and must keep all of it.
 */
const digitalCopyName = (name) =>
  `${String(name || 'report').replace(/\.[a-z0-9]{1,5}$/i, '')} (Digital Copy).pdf`;

module.exports = { digitalCopy, digitalCopyName, isMarkable, WATERMARK, NOTE, STRIP };
