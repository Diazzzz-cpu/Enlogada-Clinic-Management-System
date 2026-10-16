const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');

const { PDFName } = require('pdf-lib');
const { digitalCopy, digitalCopyName, isMarkable, STRIP, STRIP_VERIFIED } = require('../../src/utils/digitalCopy');

/**
 * The patient's copy is marked; nothing unmarked gets out. [1.114.0]
 *
 * What the pattern LOOKS like was checked by eye on the clinic's own CBC sheet. These hold the
 * properties a forger would need broken: every page is marked, the note does not cover the report,
 * and a file that cannot be marked throws instead of passing through as it was.
 */

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function twoPagePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

test('every page of a PDF is marked, and grows a strip below for the note', async () => {
  const original = await twoPagePdf();
  const marked = await PDFDocument.load(await digitalCopy(original, 'application/pdf'));
  assert.equal(marked.getPageCount(), 2);
  for (const page of marked.getPages()) {
    const box = page.getMediaBox();
    // Extended DOWNWARD: the report keeps its own coordinates, so the note covers none of it.
    assert.equal(box.y, -STRIP);
    assert.equal(box.height, 842 + STRIP);
  }
  assert.match(marked.getSubject() || '', /Digital copy/);
});

test('with a verification code, every page carries it, with a link to the page that checks it [1.126.0]', async () => {
  const url = 'https://clinic.example/?verify=ABCDE-12345';
  const marked = await PDFDocument.load(await digitalCopy(await twoPagePdf(), 'application/pdf', {
    verification: { code: 'ABCDE-12345', url },
  }));
  assert.equal(marked.getPageCount(), 2);
  for (const page of marked.getPages()) {
    const box = page.getMediaBox();
    // A taller strip, so the note keeps its size beside the QR [1.115.0]; still all below the report.
    assert.equal(box.y, -STRIP_VERIFIED);
    assert.equal(box.height, 842 + STRIP_VERIFIED);
    const annots = page.node.Annots();
    assert.ok(annots, 'the QR is clickable');
    const link = marked.context.lookup(annots.get(0));
    const action = link.lookup(PDFName.of('A'));
    assert.equal(action.lookup(PDFName.of('URI')).decodeText(), url);
    // The link sits inside the strip, never over the report.
    const rect = link.lookup(PDFName.of('Rect')).asRectangle();
    assert.ok(rect.y >= -STRIP_VERIFIED && rect.y + rect.height <= 0);
  }
});

test('an image report becomes a one-page marked PDF', async () => {
  const marked = await PDFDocument.load(await digitalCopy(PNG_1x1, 'image/png'));
  assert.equal(marked.getPageCount(), 1);
  assert.equal(marked.getPages()[0].getMediaBox().width, 595);
});

test('a Word document or spreadsheet is refused, never passed through unmarked', async () => {
  for (const type of [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ]) {
    assert.equal(isMarkable(type), false);
    await assert.rejects(digitalCopy(Buffer.from('x'), type), (err) => err.code === 'NOT_MARKABLE');
  }
});

test('a PDF that cannot be read throws, so the caller cannot fall back to the original', async () => {
  await assert.rejects(digitalCopy(Buffer.from('%PDF-1.4 not really a pdf'), 'application/pdf'));
});

test('the copy is named as a copy', () => {
  assert.equal(digitalCopyName('cbc-report.pdf'), 'cbc-report (Digital Copy).pdf');
  assert.equal(digitalCopyName('CBC - Ana Reyes'), 'CBC - Ana Reyes (Digital Copy).pdf');
  assert.equal(digitalCopyName('Lipid Profile - Ma. Zoe Abao'), 'Lipid Profile - Ma. Zoe Abao (Digital Copy).pdf');
  assert.equal(isMarkable('application/pdf'), true);
  assert.equal(isMarkable('image/jpeg; charset=binary'), true);
});
