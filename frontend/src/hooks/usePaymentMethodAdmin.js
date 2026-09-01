import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * The payment channels the clinic publishes — its own GCash and bank accounts. [1.48.0]
 *
 * ── Why this screen is SuperAdmin-only ──────────────────────────────────────────────────────
 *
 * These rows are where a patient's money is about to be sent. A wrong account number here does not
 * produce an error anywhere: payments simply arrive somewhere else, and the clinic finds out when
 * the money does not turn up. That is why the API refuses Admin as well as everyone below it, and
 * why every write is audited with the old and new number.
 *
 * ── kind is not free text ───────────────────────────────────────────────────────────────────
 *
 * Cash, GCash or Bank — the three buckets the cashier's drawer totals into. The clinic's own
 * naming goes in the label ("BPI Savings"), so a fourth kind can never land in a bucket that has
 * no tile and quietly vanish from the day's takings.
 */

/** Kept in step with COUNTER_METHODS on the server, which chk_payment_method enforces. */
// Cash is NOT here, and that is the point. [1.64.0] This dialog publishes an account a patient
// sends money to before they arrive — the panel renders it under "Send ₱X to the…" with a copy
// button. Cash is settled at the counter and has no number to copy, so a published Cash channel
// was an instruction a patient could not follow. Mirrors PUBLISHABLE_METHODS on the server, which
// is what actually enforces it.
export const METHOD_KINDS = ['GCash', 'Bank'];

const EMPTY = {
  kind: 'GCash',
  label: '',
  accountName: '',
  accountNumber: '',
  bankName: '',
  instructions: '',
  sortOrder: 0,
};

export function usePaymentMethodAdmin() {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [qrFile, setQrFile] = useState(null);
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/payment-methods/manage');
      setMethods(res.data.data.methods || []);
    } catch (err) {
      console.error('Failed to fetch payment methods:', err);
      setError(err.response?.data?.message || 'The payment methods could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setQrFile(null);
    setModalError('');
    setShowModal(true);
  };

  const openEdit = (method) => {
    setEditing(method);
    setForm({
      kind: method.kind,
      label: method.label || '',
      accountName: method.account_name || '',
      accountNumber: method.account_number || '',
      bankName: method.bank_name || '',
      instructions: method.instructions || '',
      sortOrder: method.sort_order ?? 0,
    });
    setQrFile(null);
    setModalError('');
    setShowModal(true);
  };

  const close = () => { if (!submitting) setShowModal(false); };
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setModalError('');

    if (!form.label.trim()) {
      setModalError('Give it a label — this is what the patient reads.');
      return;
    }
    if (!form.accountNumber.trim()) {
      setModalError('The account or mobile number is required. It is what the patient pays into.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        kind: form.kind,
        label: form.label.trim(),
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber.trim(),
        bankName: form.bankName.trim(),
        instructions: form.instructions.trim(),
        sortOrder: Number(form.sortOrder) || 0,
      };

      const saved = editing
        ? (await api.patch(`/payment-methods/${editing.id}`, payload)).data.data.method
        : (await api.post('/payment-methods', payload)).data.data.method;

      // The QR goes second, as its own multipart request. Deliberately not folded into the JSON
      // body above: the method must exist before a file can be attached to it, and a failed image
      // upload must not take the account details down with it.
      if (qrFile) {
        const fd = new FormData();
        fd.append('qr', qrFile);
        await api.post(`/payment-methods/${saved.id}/qr`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      setShowModal(false);
      await reload();
      toastSuccess(`${payload.label} ${editing ? 'updated' : 'added'}.`);
    } catch (err) {
      setModalError(err.response?.data?.message || 'The payment method could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  const askToggle = (method) => { setToggleError(''); setConfirmTarget(method); };
  const dismissToggle = () => { if (!toggling) setConfirmTarget(null); };

  const confirmToggle = async () => {
    if (!confirmTarget) return;
    setToggling(true);
    setToggleError('');
    try {
      // Only isActive is sent, so nothing else on the row can be blanked by a status change.
      await api.patch(`/payment-methods/${confirmTarget.id}`, { isActive: !confirmTarget.is_active });
      const wasActive = confirmTarget.is_active;
      const label = confirmTarget.label;
      setConfirmTarget(null);
      await reload();
      toastSuccess(`${label} ${wasActive ? 'hidden from patients' : 'is offered again'}.`);
    } catch (err) {
      setToggleError(err.response?.data?.message || 'The payment method could not be updated.');
    } finally {
      setToggling(false);
    }
  };

  return {
    methods, loading, error, reload,
    showModal, editing, form, qrFile, modalError, submitting,
    openAdd, openEdit, close, setField, setQrFile, submit,
    confirmTarget, toggling, toggleError, askToggle, dismissToggle, confirmToggle,
  };
}
