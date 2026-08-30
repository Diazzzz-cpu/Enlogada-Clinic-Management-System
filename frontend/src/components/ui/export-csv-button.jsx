import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from './button';
import { downloadCsv } from '../../lib/downloadCsv';
import { toastSuccess, toastError } from '../../lib/toast';

/**
 * "Export CSV" for a report panel. [1.62.0]
 *
 * One component rather than the same six lines beside four Print buttons — that duplication is
 * how the copies drift, and an export that names its file differently on one screen than another
 * is a filing problem for the clinic rather than a cosmetic one.
 *
 * Three things it gets right that a bare onClick would not:
 *
 *   - `<Button loading>` while the request is in flight, so the label stays put and the control
 *     disables. An export over a wide range is a real wait, and a button that looks idle gets
 *     pressed again — producing two identical downloads and two save dialogs.
 *   - The toast NAMES THE FILE. "Exported" on its own confirms nothing; a browser that saved
 *     silently to the Downloads folder leaves the reader with no idea what just happened or what
 *     to look for. `clinic-summary-2026-08-01_to_2026-08-28.csv` is the whole answer.
 *   - A failure reports the SERVER's reason. A 403 on a slice the account may not read is a
 *     boundary, not a fault, and saying so is the difference between a person understanding the
 *     system and distrusting it.
 */
const ExportCsvButton = ({
  path,
  params,
  fallbackName = 'report.csv',
  label = 'Export CSV',
  disabled = false,
  variant = 'outline',
  size,
  className,
}) => {
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const filename = await downloadCsv(path, params, fallbackName);
      toastSuccess('Report exported', filename);
    } catch (err) {
      toastError('Export failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onExport}
      loading={busy}
      disabled={disabled}
    >
      <Download className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Button>
  );
};

export default ExportCsvButton;
