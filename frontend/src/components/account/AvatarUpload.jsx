import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { toastSuccess, toastError } from '../../lib/toast';
import { Button } from '../ui/button';
import { Camera, Trash2 } from 'lucide-react';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3MB, matches backend/src/config/upload.js

// UI/UX Modernization Phase 8: self-service profile photo, scoped to the My Account/Profile
// page only — the initials-circle avatars elsewhere in the app (sidebar, public header) are
// left as-is (see database/migrations.md [1.9.0] for the scope reasoning).
//
// [1.120.0] The large photo at the top of the profile card, with ONE way to change it. It had a
// camera badge on the photo and an "Upload" link beside it, two controls doing the same thing.
const AvatarUpload = ({ children }) => {
  const { user, updateAvatarFlag } = useAuth();
  const [objectUrl, setObjectUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchAvatar = useCallback(async () => {
    if (!user?.hasAvatar) return;
    try {
      const res = await api.get('/auth/me/avatar', { responseType: 'blob' });
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(res.data);
      });
    } catch (err) {
      console.error('Failed to load avatar:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.hasAvatar]);

  useEffect(() => {
    fetchAvatar();
  }, [fetchAvatar]);

  // Revoke the blob URL on unmount only — fetchAvatar itself revokes the previous one whenever
  // it creates a new one, so cleaning up here too would double-revoke a URL still in use.
  useEffect(() => () => {
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return prev;
    });
  }, []);

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toastError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toastError('Image must be 3MB or smaller.');
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);
    setUploading(true);
    try {
      await api.post('/auth/me/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      updateAvatarFlag(true);
      await fetchAvatar();
      toastSuccess('Profile photo updated.');
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await api.delete('/auth/me/avatar');
      updateAvatarFlag(false);
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      toastSuccess('Profile photo removed.');
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to remove photo.');
    } finally {
      setUploading(false);
    }
  };

  const initial = user?.firstName ? user.firstName.charAt(0).toUpperCase() : 'U';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-primary text-3xl font-bold text-primary-foreground ring-4 ring-brand-50">
        {objectUrl ? (
          <img src={objectUrl} alt="Your profile photo" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </div>
      {children}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="h-3.5 w-3.5" />
          {objectUrl ? 'Change photo' : 'Upload photo'}
        </Button>
        {objectUrl && (
          <Button type="button" size="sm" variant="ghost" onClick={handleRemove} disabled={uploading}>
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
      </div>
      <p className="m-0 text-meta text-slate-500">JPEG, PNG or WebP, up to 3 MB.</p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
        aria-label="Profile photo file"
      />
    </div>
  );
};

export default AvatarUpload;
