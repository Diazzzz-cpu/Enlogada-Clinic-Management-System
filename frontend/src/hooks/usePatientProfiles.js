import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { validatePatientProfile } from '../validations/patientValidation';

const BLANK_PROFILE = {
  firstName: '',
  lastName: '',
  birthdate: '',
  sex: 'Male',
  address: '',
  contactNumber: '',
  emergencyContact: '',
  patientTypeId: '',
};

/**
 * pg returns birthdate as a full ISO instant (see the Module 3 report for why), so it is
 * converted to the local calendar date an `<input type="date">` expects — built from local
 * getters, never toISOString, which in Philippine time would shift the day backwards.
 */
const toDateInputValue = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * The patient profiles one account owns, and which of them is currently being viewed.
 *
 * An account owns SEVERAL profiles — a parent booking for their children is the ordinary case,
 * which is why `GET /patients/my-profiles` is plural. Everything on the portal hangs off which
 * one is selected, so the selection lives here with the list rather than beside whatever happens
 * to read it.
 *
 * Adding and editing are two flows over the same shape, kept apart because they must not share
 * a draft: a half-typed new profile leaking into the edit dialog would offer to overwrite a real
 * patient record with it. Validation is the same `validatePatientProfile` reception uses, so a
 * patient and a receptionist cannot create records held to different standards.
 */
export function usePatientProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState(BLANK_PROFILE);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [showEdit, setShowEdit] = useState(false);
  const [editDraft, setEditDraft] = useState(BLANK_PROFILE);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await api.get('/patients/my-profiles');
      const list = response.data.data.patients;
      setProfiles(list);
      // Select the first profile only when nothing is chosen yet, so a reload after an edit
      // does not yank the view back to the top of the list. [1.136.0] A selection that is no
      // longer on the account (the clinic took the record back out) falls back the same way,
      // rather than every tab asking for a record it can no longer read.
      setSelectedId((current) => {
        const stillHere = current && list.some((p) => String(p.id) === String(current));
        if (stillHere) return current;
        return list.length > 0 ? list[0].id.toString() : null;
      });
      return list;
    } catch (err) {
      console.error('Failed to fetch patient profiles:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the resolved profile object in step with the id. Derived from `profiles` so an edit
  // that reloads the list is reflected here without a second fetch.
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setSelected(profiles.find((p) => p.id === parseInt(selectedId, 10)) || null);
  }, [selectedId, profiles]);

  const openAdd = (open = true) => {
    setAddError('');
    setShowAdd(open);
  };

  const add = async (e) => {
    e?.preventDefault();
    setAddError('');

    const invalid = validatePatientProfile(addDraft);
    if (invalid) {
      setAddError(invalid);
      return;
    }

    setAdding(true);
    try {
      const response = await api.post('/patients', addDraft);
      const created = response.data.data.patient;
      setAddDraft(BLANK_PROFILE);
      setShowAdd(false);
      await load();
      // Jump to the profile just created — the reason someone added it is to use it.
      setSelectedId(created.id.toString());
    } catch (err) {
      setAddError(err.response?.data?.message || 'Failed to create patient profile');
    } finally {
      setAdding(false);
    }
  };

  /** Open the edit dialog pre-filled from the selected profile. */
  const openEdit = () => {
    if (!selected) return;
    setEditError('');
    setEditDraft({
      firstName: selected.first_name || '',
      lastName: selected.last_name || '',
      birthdate: toDateInputValue(selected.birthdate),
      sex: selected.sex || 'Male',
      address: selected.address || '',
      contactNumber: selected.contact_number || '',
      emergencyContact: selected.emergency_contact || '',
      patientTypeId: selected.patient_type_id ? selected.patient_type_id.toString() : '',
    });
    setShowEdit(true);
  };

  const closeEdit = (open = false) => setShowEdit(open);

  const edit = async (e) => {
    e?.preventDefault();
    setEditError('');

    const invalid = validatePatientProfile(editDraft);
    if (invalid) {
      setEditError(invalid);
      return;
    }

    setEditing(true);
    try {
      await api.put(`/patients/${selected.id}`, editDraft);
      setShowEdit(false);
      await load();
    } catch (err) {
      setEditError(err.response?.data?.message || 'Failed to update patient profile');
    } finally {
      setEditing(false);
    }
  };

  return {
    profiles, selectedId, setSelectedId, selected, loading,
    showAdd, openAdd, addDraft, setAddDraft, adding, addError, add,
    showEdit, openEdit, closeEdit, editDraft, setEditDraft, editing, editError, edit,
    reload: load,
  };
}

export default usePatientProfiles;
