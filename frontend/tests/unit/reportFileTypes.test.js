import { describe, it, expect } from 'vitest';
import { isAllowedReportFile, REPORT_FILE_ACCEPT } from '../../src/lib/reportFileTypes.js';

// The dialog's instant check, mirroring backend/src/constants/reportFileTypes.js. [1.96.0]
const file = (name, type = '') => ({ name, type });

describe('isAllowedReportFile', () => {
  it('accepts PDF, JPEG and PNG as before, even without an extension', () => {
    expect(isAllowedReportFile(file('scan.pdf', 'application/pdf'))).toBe(true);
    expect(isAllowedReportFile(file('scan', 'application/pdf'))).toBe(true);
    expect(isAllowedReportFile(file('photo.jpeg', 'image/jpeg'))).toBe(true);
    expect(isAllowedReportFile(file('photo.png', 'image/png'))).toBe(true);
  });

  it('accepts Word and spreadsheet reports', () => {
    expect(isAllowedReportFile(file('CBC.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.doc', 'application/msword'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.odt', 'application/vnd.oasis.opendocument.text'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.rtf', 'application/rtf'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.xls', 'application/vnd.ms-excel'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.ods', 'application/vnd.oasis.opendocument.spreadsheet'))).toBe(true);
    expect(isAllowedReportFile(file('CBC.csv', 'text/csv'))).toBe(true);
  });

  it('copes with the types browsers really report', () => {
    expect(isAllowedReportFile(file('lipid.csv', 'application/vnd.ms-excel'))).toBe(true); // Windows + Excel
    expect(isAllowedReportFile(file('lipid.xlsx', ''))).toBe(true); // no Office installed
    expect(isAllowedReportFile(file('LIPID.DOCX', ''))).toBe(true);
  });

  it('refuses everything else', () => {
    expect(isAllowedReportFile(file('report.docm', 'application/vnd.ms-word.document.macroEnabled.12'))).toBe(false);
    expect(isAllowedReportFile(file('setup.exe', 'application/x-msdownload'))).toBe(false);
    expect(isAllowedReportFile(file('page.html', 'text/html'))).toBe(false);
    expect(isAllowedReportFile(file('report', ''))).toBe(false);
    expect(isAllowedReportFile(null)).toBe(false);
  });

  it('offers every accepted extension in the file picker', () => {
    for (const ext of ['.pdf', '.jpg', '.png', '.docx', '.doc', '.odt', '.rtf', '.xlsx', '.xls', '.ods', '.csv']) {
      expect(REPORT_FILE_ACCEPT.split(',')).toContain(ext);
    }
  });
});
