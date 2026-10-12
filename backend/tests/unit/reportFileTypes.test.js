const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveReportType, contentMatches, servesInline } = require('../../src/constants/reportFileTypes');

/**
 * Which files may be a diagnostic report, and how one is recognised. [1.96.0]
 *
 * The declared mime type is the weakest of three signals for office files, so these pin both halves
 * of the rule: what the name and label may claim, and what the bytes must then prove.
 */

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const zipWith = (...names) => Buffer.concat([ZIP, Buffer.from(names.join('\n'), 'latin1')]);
const key = (name, mime) => resolveReportType(name, mime)?.key ?? null;

test('PDF, JPEG and PNG are still accepted on their label alone, as before', () => {
  assert.equal(key('scan', 'application/pdf'), 'pdf');
  assert.equal(key('photo', 'image/jpeg'), 'jpeg');
  assert.equal(key('IMG_0001.PNG', 'image/png'), 'png');
});

test('office reports resolve by extension, with the label they normally arrive with', () => {
  assert.equal(key('CBC.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
  assert.equal(key('CBC.doc', 'application/msword'), 'doc');
  assert.equal(key('CBC.odt', 'application/vnd.oasis.opendocument.text'), 'odt');
  assert.equal(key('CBC.rtf', 'text/rtf'), 'rtf');
  assert.equal(key('CBC.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
  assert.equal(key('CBC.xls', 'application/vnd.ms-excel'), 'xls');
  assert.equal(key('CBC.ods', 'application/vnd.oasis.opendocument.spreadsheet'), 'ods');
  assert.equal(key('CBC.csv', 'text/csv'), 'csv');
});

test('the labels browsers really send for these files are accepted', () => {
  // Windows labels a .csv as an Excel file whenever Excel is installed.
  assert.equal(key('lipid.csv', 'application/vnd.ms-excel'), 'csv');
  // A PC without Office sends no type at all, which multer sees as octet-stream.
  assert.equal(key('lipid.xlsx', 'application/octet-stream'), 'xlsx');
  assert.equal(key('lipid.docx', ''), 'docx');
  // Extensions are case-insensitive.
  assert.equal(key('LIPID.XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
});

test('anything else is refused before it is saved', () => {
  assert.equal(key('report.docm', 'application/vnd.ms-word.document.macroEnabled.12'), null);
  assert.equal(key('report.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'), null);
  assert.equal(key('setup.exe', 'application/octet-stream'), null);
  assert.equal(key('report.html', 'text/html'), null);
  // An allowlisted extension does not rescue a label that type never arrives with.
  assert.equal(key('report.docx', 'text/html'), null);
  // Office types are never accepted on an unknown label without their extension.
  assert.equal(key('report', 'application/octet-stream'), null);
});

test('the saved bytes must be the claimed format', () => {
  const t = (name, mime) => resolveReportType(name, mime);
  assert.ok(contentMatches(t('a.pdf', 'application/pdf'), Buffer.from('%PDF-1.7 ...')));
  assert.ok(contentMatches(t('a.docx', ''), zipWith('[Content_Types].xml', 'word/document.xml')));
  assert.ok(contentMatches(t('a.xlsx', ''), zipWith('[Content_Types].xml', 'xl/workbook.xml')));
  assert.ok(contentMatches(t('a.odt', ''), zipWith('mimetypeapplication/vnd.oasis.opendocument.text')));
  assert.ok(contentMatches(t('a.ods', ''), zipWith('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')));
  assert.ok(contentMatches(t('a.doc', 'application/msword'), Buffer.concat([OLE, Buffer.alloc(64)])));
  assert.ok(contentMatches(t('a.xls', 'application/vnd.ms-excel'), Buffer.concat([OLE, Buffer.alloc(64)])));
  assert.ok(contentMatches(t('a.rtf', 'text/rtf'), Buffer.from('{\\rtf1\\ansi Hemoglobin 13.5}')));
  assert.ok(contentMatches(t('a.csv', 'text/csv'), Buffer.from('﻿Test,Result,Unit\nHemoglobin,13.5,g/dL\n')));
});

test('a renamed or mismatched file is refused by its contents', () => {
  const t = (name, mime) => resolveReportType(name, mime);
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
  assert.equal(contentMatches(t('report.docx', ''), exe), false);
  assert.equal(contentMatches(t('report.pdf', 'application/pdf'), exe), false);
  // A spreadsheet renamed to .docx is a ZIP, but not a Word document.
  assert.equal(contentMatches(t('report.docx', ''), zipWith('[Content_Types].xml', 'xl/workbook.xml')), false);
  // A binary file renamed to .csv contains NUL bytes; real CSV exports do not.
  assert.equal(contentMatches(t('report.csv', 'text/csv'), exe), false);
  assert.equal(contentMatches(t('report.csv', 'text/csv'), Buffer.alloc(0)), false);
});

test('PDFs and images open in the browser; office files and CSV download', () => {
  assert.equal(servesInline('application/pdf'), true);
  assert.equal(servesInline('image/png'), true);
  assert.equal(servesInline('text/csv'), false);
  assert.equal(servesInline('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  assert.equal(servesInline(null), false);
});
