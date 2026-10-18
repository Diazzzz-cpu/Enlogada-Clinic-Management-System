import { useMemo, useState } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';
import {
  COLUMNS, SPLIT_COLUMNS, ROLE_LABEL, areasFor, changedRoles, describeChanges, draftFrom, heldByNobody,
  missingCompanions, toggle,
} from '../lib/whoSeesWhat';

const ROOM_ROLES = ['Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'];

/**
 * The "Who sees what" grid's working copy, and saving it. [1.78.0]
 *
 * Reads the matrix useAccessControl already loaded, so the grid and the one-person editor beside
 * it can never be showing two different fetches of the same templates.
 *
 * `draft` is null while nothing has been changed, and the saved templates are shown as they are.
 * It is set by the first switch, and cleared by a save or Discard. Deliberately NOT reset when the
 * matrix reloads: after a save that fails part-way, the reload shows what the server now holds and
 * the list of unsaved changes shrinks to what still has to be sent, instead of the person's edits
 * vanishing along with the error that explains them.
 *
 * Only the roles that changed are saved, each with its whole new template, through the endpoint
 * the old screen used (`PUT /rbac/roles/:id/permissions`). One request per role, in turn, so a
 * failure names the role it stopped at.
 */
export function useWhoSeesWhat(access) {
  const { permissions, roles, rolePermissions, reload } = access;

  const areas = useMemo(() => areasFor(permissions), [permissions]);
  const original = useMemo(() => draftFrom(rolePermissions), [rolePermissions]);
  const [draft, setDraft] = useState(null);
  const working = draft || original;

  const [split, setSplit] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const columns = split ? SPLIT_COLUMNS : COLUMNS;
  const changes = useMemo(() => describeChanges(original, working, areas), [original, working, areas]);

  // Said only for what THIS draft leaves with nobody. A permission no staff role held before (online
  // booking is the patient's own) is not news, and warning about it every time would be noise.
  const newlyUnheld = useMemo(() => {
    const before = new Set(heldByNobody(original, areas));
    return heldByNobody(working, areas).filter((name) => !before.has(name));
  }, [original, working, areas]);

  // [1.130.0] A switch that is on without what it needs grants nothing; say so beside the changes.
  const incomplete = useMemo(() => missingCompanions(working, areas), [working, areas]);

  const flip = (permission, column) => {
    setDraft((current) => toggle(current || original, permission, column.roles));
    setSavedAt(null);
    setSaveError('');
  };

  const toggleArea = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const allOpen = areas.length > 0 && areas.every((a) => open.has(a.key));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(areas.map((a) => a.key)));

  const discard = () => {
    setDraft(null);
    setSaveError('');
  };

  const save = async () => {
    const idOf = new Map(permissions.map((p) => [p.name, p.id]));
    const targets = changedRoles(original, working);
    if (!targets.length) return;
    setSaving(true);
    setSaveError('');
    let stoppedAt = null;
    try {
      for (const roleName of targets) {
        stoppedAt = roleName;
        const role = roles.find((r) => r.name === roleName);
        if (!role) continue;
        const permissionIds = [...working[roleName]].map((name) => idOf.get(name)).filter(Number.isInteger);
        await api.put(`/rbac/roles/${role.id}/permissions`, { permissionIds });
      }
      const who = [...new Set(targets.map((r) => (ROOM_ROLES.includes(r) ? 'Lab, X-Ray, Ultrasound' : ROLE_LABEL[r])))];
      await reload();
      setDraft(null);
      setSavedAt(Date.now());
      toastSuccess('Who sees what is saved', changes.length === 1 ? changes[0].text : `${changes.length} changes, for ${who.join(', ')}`);
    } catch (err) {
      const message = err.response?.data?.message || 'The server did not answer.';
      setSaveError(`Couldn't save ${ROLE_LABEL[stoppedAt] || stoppedAt}: ${message} The list below is what is still unsaved.`);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return {
    areas, columns, draft: working, changes, newlyUnheld, incomplete,
    split, toggleSplit: () => setSplit((s) => !s),
    open, toggleArea, allOpen, toggleAll,
    flip, discard, save, saving, saveError, savedAt,
  };
}

export default useWhoSeesWhat;
